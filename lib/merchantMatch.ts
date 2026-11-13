import type { Budget } from "./budget";
import type { LatLng } from "./types";
import { fetchWithTimeout, haversine, nameSimilarity, normalizeName } from "./util";

/**
 * 결제 알림의 가맹점 이름 → 카카오 장소.
 * 카드 알림 가맹점명은 잘리거나(10자 안팎), PG사·법인 표기가 붙거나, 지점명이 붙어서 온다.
 */
export interface MatchedPlace {
  id: string;
  name: string;
  category: string;
  categoryGroup: string;
  address: string;
  roadAddress: string;
  phone: string;
  lat: number;
  lng: number;
  kakaoUrl: string;
}

export type MerchantMatch =
  | { status: "matched"; place: MatchedPlace; confidence: number }
  /** 음식점·카페가 아닌 곳 (편의점·마트·온라인·배달 등) */
  | { status: "notFood"; reason: string; place?: MatchedPlace }
  | { status: "unmatched" };

const ORG = /\(주\)|㈜|주식회사|\(유\)|유한회사|\(사\)|\(재\)/g;
const PG_PREFIX = /^(KCP|NHN\s*KCP|KG\s*이니시스|이니시스|INICIS|토스페이먼츠|토스페이|나이스페이(먼츠)?|NICE|다날|스마트로|KICC|한국정보통신|KSNET|KIS|페이레터|헥토|네이버페이|카카오페이|페이코|PAYCO|N페이|SPC)\s*[-_:·)\]]*\s*/i;
/** 이 이름이면 가게 방문이 아니다 */
const ONLINE = /^(우아한형제들|배달의민족|배민|쿠팡이츠|쿠팡|요기요|위대한상상|땡겨요|네이버파이낸셜|카카오T|카카오모빌리티|티머니|SKT|SK텔레콤|KT$|LGU|넷플릭스|유튜브|구글|google|apple|애플코리아|11번가|지마켓|G마켓|옥션|SSG닷컴|무신사|마켓컬리|컬리|당근)/i;
const NOT_FOOD_CATEGORY = /편의점|대형마트|슈퍼마켓|마트|주유|약국|병원|의원|주차|미용|화장품|의류|서점|문구|영화|교통|숙박|세탁|휴대폰|전자/;

export function cleanMerchantName(raw: string): string {
  let s = raw.replace(ORG, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i++) s = s.replace(PG_PREFIX, "").trim();
  return s
    .replace(/[_]+/g, " ")
    .replace(/[\[\]【】]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface KakaoDoc {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  place_url: string;
}

const toPlace = (d: KakaoDoc): MatchedPlace => ({
  id: d.id,
  name: d.place_name,
  category: d.category_name,
  categoryGroup: d.category_group_code,
  address: d.address_name,
  roadAddress: d.road_address_name,
  phone: d.phone,
  lat: Number(d.y),
  lng: Number(d.x),
  kakaoUrl: d.place_url,
});

async function keyword(query: string, loc: LatLng | null, radius: number, budget: Budget): Promise<KakaoDoc[]> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) throw new Error("KAKAO_REST_API_KEY가 설정되지 않았습니다.");
  if (!budget.take()) return [];
  const params = new URLSearchParams({ query, size: "15", sort: "accuracy" });
  if (loc) {
    params.set("x", String(loc.lng));
    params.set("y", String(loc.lat));
    params.set("radius", String(Math.min(20000, Math.max(100, Math.round(radius)))));
  }
  const res = await fetchWithTimeout(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`, {
    headers: { Authorization: `KakaoAK ${key}` },
  });
  if (!res.ok) throw new Error(`카카오 검색 실패 (${res.status})`);
  return ((await res.json()) as { documents: KakaoDoc[] }).documents ?? [];
}

/** 이름 유사도 (잘린 이름도 앞부분이 같으면 높게) */
function nameScore(merchant: string, place: string): number {
  const m = normalizeName(merchant);
  const p = normalizeName(place);
  if (!m || !p) return 0;
  // 카드 알림은 앞 10자 안팎만 오는 경우가 많다
  if (m.length >= 4 && p.startsWith(m)) return 0.95;
  return nameSimilarity(merchant, place);
}

function pick(docs: KakaoDoc[], merchant: string, loc: LatLng | null): { doc: KakaoDoc; score: number } | null {
  let best: { doc: KakaoDoc; score: number } | null = null;
  for (const d of docs) {
    const sim = nameScore(merchant, d.place_name);
    if (sim < 0.5) continue;
    const dist = loc ? haversine(loc, { lat: Number(d.y), lng: Number(d.x) }) : null;
    // 가까울수록 가산 (300m 안이면 거의 확실)
    const near = dist == null ? 0 : dist < 300 ? 0.2 : dist < 1000 ? 0.12 : dist < 3000 ? 0.05 : 0;
    const food = d.category_group_code === "FD6" || d.category_group_code === "CE7" ? 0.05 : 0;
    const score = sim + near + food;
    if (!best || score > best.score) best = { doc: d, score };
  }
  return best;
}

export async function matchMerchant(rawMerchant: string, loc: LatLng | null, budget: Budget): Promise<MerchantMatch> {
  const merchant = cleanMerchantName(rawMerchant);
  if (!merchant || merchant.length < 2) return { status: "unmatched" };
  if (ONLINE.test(merchant.replace(/\s+/g, ""))) return { status: "notFood", reason: "배달·온라인·교통" };

  // 1) 결제 위치 근처 → 2) 넓게 → 3) 이름만 (위치 없을 때)
  const tries: Array<{ q: string; loc: LatLng | null; radius: number }> = loc
    ? [
        { q: merchant, loc, radius: 2000 },
        { q: merchant, loc, radius: 20000 },
      ]
    : [{ q: merchant, loc: null, radius: 0 }];
  // "비케이알 버거킹"처럼 법인명이 앞에 붙은 경우: 마지막 단어로 근처만
  const words = merchant.split(" ");
  if (loc && words.length > 1 && words[words.length - 1].length >= 2) tries.push({ q: words[words.length - 1], loc, radius: 1500 });
  for (const t of tries) {
    if (budget.remaining < 1) break;
    const docs = await keyword(t.q, t.loc, t.radius, budget);
    const best = pick(docs, t.q, loc);
    if (!best) continue;
    const place = toPlace(best.doc);
    const food = best.doc.category_group_code === "FD6" || best.doc.category_group_code === "CE7";
    if (!food) {
      const cat = place.category.split(">").map((s) => s.trim());
      // 음식점 분류가 아니어도 이름에 음식 업종이 보이면(푸드코트 매장 등) 음식으로 본다
      if (NOT_FOOD_CATEGORY.test(place.category) || !/음식|카페|베이커리|제과|디저트/.test(place.category)) {
        return { status: "notFood", reason: cat[cat.length - 1] || "음식점 아님", place };
      }
    }
    return { status: "matched", place, confidence: Math.min(1, best.score) };
  }
  return { status: "unmatched" };
}
