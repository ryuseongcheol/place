import type { BasePlace, KakaoReviewInfo, LatLng } from "./types";
import { BROWSER_UA, TTLCache, collectStrings, deepFind, fetchWithTimeout, toNumber } from "./util";

const KAKAO_LOCAL = "https://dapi.kakao.com/v2/local";

const searchCache = new TTLCache<BasePlace[]>(10 * 60 * 1000);
const reviewCache = new TTLCache<KakaoReviewInfo | null>(6 * 60 * 60 * 1000);
const regionCache = new TTLCache<string | null>(24 * 60 * 60 * 1000);

function authHeaders() {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) throw new Error("KAKAO_REST_API_KEY가 설정되지 않았습니다.");
  return { Authorization: `KakaoAK ${key}` };
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
  distance: string;
}

/**
 * [공식] 카카오 로컬 키워드 검색. 반경 내 음식점(FD6) / 카페(CE7)만.
 * https://developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-keyword
 */
export async function searchKakao(
  keyword: string,
  loc: LatLng,
  radius: number,
  categoryCode: "FD6" | "CE7",
  pages = 2,
): Promise<BasePlace[]> {
  const cacheKey = `${keyword}|${loc.lat.toFixed(4)}|${loc.lng.toFixed(4)}|${radius}|${categoryCode}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const out: BasePlace[] = [];
  for (let page = 1; page <= pages; page++) {
    const params = new URLSearchParams({
      query: keyword,
      x: String(loc.lng),
      y: String(loc.lat),
      radius: String(Math.min(20000, Math.max(100, radius))),
      category_group_code: categoryCode,
      sort: "accuracy",
      page: String(page),
      size: "15",
    });
    const res = await fetchWithTimeout(`${KAKAO_LOCAL}/search/keyword.json?${params}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`카카오 검색 실패 (${res.status}): ${await res.text().catch(() => "")}`);
    const data = (await res.json()) as { documents: KakaoDoc[]; meta: { is_end: boolean } };
    for (const d of data.documents) {
      out.push({
        id: d.id,
        name: d.place_name,
        category: d.category_name,
        address: d.address_name,
        roadAddress: d.road_address_name,
        phone: d.phone,
        lat: Number(d.y),
        lng: Number(d.x),
        distance: Number(d.distance) || 0,
        kakaoUrl: d.place_url,
        searchRank: out.length,
        matchedKeywords: [keyword],
      });
    }
    if (data.meta.is_end) break;
  }
  searchCache.set(cacheKey, out);
  return out;
}

/** [공식] 좌표 → 행정동 이름 (네이버 검색어 보조용) */
export async function regionName(loc: LatLng): Promise<string | null> {
  const key = `${loc.lat.toFixed(3)}|${loc.lng.toFixed(3)}`;
  const cached = regionCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const res = await fetchWithTimeout(`${KAKAO_LOCAL}/geo/coord2regioncode.json?x=${loc.lng}&y=${loc.lat}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { documents: Array<{ region_type: string; region_2depth_name: string; region_3depth_name: string }> };
    const doc = data.documents.find((d) => d.region_type === "H") ?? data.documents[0];
    const name = doc ? `${doc.region_2depth_name} ${doc.region_3depth_name}`.trim() : null;
    regionCache.set(key, name);
    return name;
  } catch {
    return null;
  }
}

/**
 * [비공식] 카카오맵 장소 상세의 별점·후기.
 * 카카오맵 웹 페이지가 내부적으로 호출하는 엔드포인트로, 예고 없이 바뀌거나 막힐 수 있다.
 * 두 가지 알려진 형태를 순서대로 시도하고, 응답 구조는 키 이름으로 느슨하게 파싱한다.
 */
export async function fetchKakaoReviews(placeId: string): Promise<KakaoReviewInfo | null> {
  const cached = reviewCache.get(placeId);
  if (cached !== undefined) return cached;

  const attempts: Array<{ url: string; headers: Record<string, string> }> = [
    {
      url: `https://place-api.map.kakao.com/places/panel3/${placeId}`,
      headers: { pf: "web", Referer: `https://place.map.kakao.com/${placeId}`, Origin: "https://place.map.kakao.com" },
    },
    {
      url: `https://place.map.kakao.com/main/v/${placeId}`,
      headers: { Referer: `https://place.map.kakao.com/${placeId}` },
    },
  ];

  for (const a of attempts) {
    try {
      const res = await fetchWithTimeout(a.url, {
        headers: { "User-Agent": BROWSER_UA, Accept: "application/json", "Accept-Language": "ko-KR,ko;q=0.9", ...a.headers },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      const info = parseKakaoDetail(json);
      if (info) {
        reviewCache.set(placeId, info);
        return info;
      }
    } catch {
      // 다음 형태 시도
    }
  }
  reviewCache.set(placeId, null);
  return null;
}

export function parseKakaoDetail(json: unknown): KakaoReviewInfo | null {
  // 신규 형태: { kakaomap_review: { score_set: { average_score, review_count } }, blog_review: { review_count } ... }
  // 구 형태:   { basicInfo: { feedback: { scoresum, scorecnt, comntcnt, blogrvwcnt } }, comment: { list: [{ contents }] } }
  let rating: number | null = null;
  let ratingCount = 0;

  const avg = toNumber(deepFind(json, ["average_score", "averageScore", "avg_score"]));
  if (avg !== null) rating = avg;

  const scoresum = toNumber(deepFind(json, ["scoresum"]));
  const scorecnt = toNumber(deepFind(json, ["scorecnt"]));
  if (rating === null && scoresum !== null && scorecnt) rating = scoresum / scorecnt;
  if (scorecnt) ratingCount = scorecnt;

  const reviewCount = toNumber(deepFind(json, ["review_count", "comntcnt", "reviewCount", "kakaomap_review_count"])) ?? 0;
  if (!ratingCount) ratingCount = reviewCount;

  const blogCount =
    toNumber(deepFind((json as Record<string, unknown>)?.["blog_review"] ?? json, ["blogrvwcnt", "review_count", "total_count"])) ?? 0;

  const snippets = collectStrings(json, ["contents", "content", "review_text"], 8)
    .filter((s) => s.length >= 8)
    .map((s) => s.replace(/\s+/g, " ").slice(0, 160));

  const tags = collectStrings(json, ["strength_name", "keyword_name", "name"], 30)
    .filter((s) => s.length <= 20)
    .slice(0, 8);

  if (rating === null && !reviewCount && snippets.length === 0) return null;
  return {
    rating: rating !== null ? Math.round(Math.min(5, Math.max(0, rating)) * 10) / 10 : null,
    ratingCount,
    reviewCount,
    blogReviewCount: blogCount === reviewCount ? 0 : blogCount,
    snippets,
    tags,
  };
}
