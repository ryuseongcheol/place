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

/** 후보 장소 (거리: 결제 위치 또는 기준점에서) */
export interface Candidate extends MatchedPlace {
  distance: number | null;
  score: number;
}

export type MerchantMatch =
  | {
      status: "matched";
      place: MatchedPlace;
      confidence: number;
      /** 같은 이름 지점이 여러 곳이라 사용자가 확인해야 함 */
      ambiguous?: boolean;
      candidates?: Candidate[];
    }
  /** 음식점·카페가 아닌 곳 (편의점·마트·온라인·배달 등) */
  | { status: "notFood"; reason: string; place?: MatchedPlace; candidates?: Candidate[] }
  | { status: "unmatched"; candidates?: Candidate[] };

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

async function keyword(query: string, loc: LatLng | null, radius: number, budget: Budget, sort: "accuracy" | "distance" = "accuracy"): Promise<KakaoDoc[]> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) throw new Error("KAKAO_REST_API_KEY가 설정되지 않았습니다.");
  if (!budget.take()) return [];
  const params = new URLSearchParams({ query, size: "15", sort: loc ? sort : "accuracy" });
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

const isFood = (d: KakaoDoc) =>
  d.category_group_code === "FD6" || d.category_group_code === "CE7" || (/음식|카페|베이커리|제과|디저트/.test(d.category_name) && !NOT_FOOD_CATEGORY.test(d.category_name));

/**
 * 후보 점수: 이름 유사도 + 가까움.
 * 결제 순간 위치(loc)가 있으면 그 거리를 강하게, 없으면 기준점(같은 날 다른 결제 위치·내 위치·설정한 동네) 거리를 약하게 반영
 */
function rank(docs: KakaoDoc[], merchant: string, loc: LatLng | null, anchors: LatLng[], alt: string | null = null): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    // 법인명이 앞에 붙은 이름은 마지막 단어로도 비교 (조금 낮게)
    const sim = Math.max(nameScore(merchant, d.place_name), alt ? nameScore(alt, d.place_name) * 0.95 : 0);
    if (sim < 0.5) continue;
    const pos = { lat: Number(d.y), lng: Number(d.x) };
    let distance: number | null = null;
    let near = 0;
    if (loc) {
      distance = haversine(loc, pos);
      near = distance < 300 ? 0.3 : distance < 1000 ? 0.2 : distance < 3000 ? 0.1 : distance < 10000 ? 0.03 : -0.1;
    } else if (anchors.length) {
      distance = Math.min(...anchors.map((a) => haversine(a, pos)));
      near = distance < 1000 ? 0.15 : distance < 3000 ? 0.1 : distance < 10000 ? 0.05 : 0;
    }
    const score = sim + near + (isFood(d) ? 0.05 : 0);
    out.push({ ...toPlace(d), distance: distance == null ? null : Math.round(distance), score: Math.round(score * 1000) / 1000 });
  }
  return out.sort((a, b) => b.score - a.score);
}

export async function matchMerchant(rawMerchant: string, loc: LatLng | null, budget: Budget, anchors: LatLng[] = []): Promise<MerchantMatch> {
  const merchant = cleanMerchantName(rawMerchant);
  if (!merchant || merchant.length < 2) return { status: "unmatched" };
  if (ONLINE.test(merchant.replace(/\s+/g, ""))) return { status: "notFood", reason: "배달·온라인·교통" };

  // 검색 순서: 결제 위치 근처 → 넓게 / 위치가 없으면 기준점 근처 → 이름만(전국)
  const tries: Array<{ q: string; loc: LatLng | null; radius: number }> = [];
  if (loc) tries.push({ q: merchant, loc, radius: 2000 }, { q: merchant, loc, radius: 20000 });
  else {
    for (const a of anchors.slice(0, 3)) tries.push({ q: merchant, loc: a, radius: 8000 });
    tries.push({ q: merchant, loc: null, radius: 0 });
  }
  // "비케이알 버거킹"처럼 법인명이 앞에 붙은 경우: 마지막 단어로 근처만
  const words = merchant.split(" ");
  const center = loc ?? anchors[0] ?? null;
  const alt = words.length > 1 && words[words.length - 1].length >= 2 ? words[words.length - 1] : null;
  if (center && alt) tries.push({ q: alt, loc: center, radius: 1500 });

  const pool: KakaoDoc[] = [];
  for (const t of tries) {
    if (budget.remaining < 1) break;
    pool.push(...(await keyword(t.q, t.loc, t.radius, budget)));
    const ranked = rank(pool, merchant, loc, anchors, alt);
    const top = ranked[0];
    // 결제 위치 1.5km 안에 이름이 잘 맞는 곳이 있으면 더 찾지 않는다
    if (top && loc && top.distance != null && top.distance < 1500 && top.score >= 0.9) break;
    // 기준점 근처에서 찾았으면 전국 검색은 하지 않는다
    if (top && !loc && t.loc && top.distance != null && top.distance < 8000 && top.score >= 0.85) break;
  }
  const ranked = rank(pool, merchant, loc, anchors, alt);
  const candidates = ranked.slice(0, 6);
  const top = ranked[0];
  if (!top) return { status: "unmatched", candidates: [] };

  const doc = pool.find((d) => d.id === top.id)!;
  if (!isFood(doc)) {
    const cat = top.category.split(">").map((x) => x.trim());
    return { status: "notFood", reason: cat[cat.length - 1] || "음식점 아님", place: top, candidates };
  }
  // 애매한지: 결제 위치가 없거나 멀고, 이름이 비슷한 다른 지점이 점수 차이 적게 있을 때
  const second = ranked.find((c) => c.id !== top.id && c.score >= 0.8);
  const preciseLoc = !!loc && top.distance != null && top.distance < 1500;
  const ambiguous = !preciseLoc && (!!second && top.score - second.score < 0.15 || (!loc && !anchors.length) || (top.distance != null && top.distance > 10000));
  return { status: "matched", place: top, confidence: Math.min(1, top.score), ambiguous, candidates };
}

/** 가게 이름으로 장소 찾기 (타임라인에서 장소 바꾸기). 위치가 있으면 가까운 순 */
export async function searchPlaces(q: string, loc: LatLng | null, budget: Budget): Promise<Candidate[]> {
  const query = cleanMerchantName(q) || q.trim();
  if (!query) return [];
  const docs = await keyword(query, loc, loc ? 20000 : 0, budget, loc ? "distance" : "accuracy");
  return docs.map((d) => ({
    ...toPlace(d),
    distance: loc ? Math.round(haversine(loc, { lat: Number(d.y), lng: Number(d.x) })) : null,
    score: 0,
  }));
}
