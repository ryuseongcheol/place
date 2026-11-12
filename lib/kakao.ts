import type { Budget } from "./budget";
import { parseKakaoDetail } from "./kakaoDetail";
export { parseKakaoDetail };
import type { BasePlace, KakaoReviewInfo, LatLng } from "./types";
import { BROWSER_UA, TTLCache, collectStrings, deepFind, fetchWithTimeout, toNumber } from "./util";

const KAKAO_LOCAL = "https://dapi.kakao.com/v2/local";

const searchCache = new TTLCache<BasePlace[]>(10 * 60 * 1000);
const rawCache = new TTLCache<unknown | null>(6 * 60 * 60 * 1000, 500);
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
  budget?: Budget,
): Promise<BasePlace[]> {
  const cacheKey = `${keyword}|${loc.lat.toFixed(4)}|${loc.lng.toFixed(4)}|${radius}|${categoryCode}|${pages}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const out: BasePlace[] = [];
  for (let page = 1; page <= pages; page++) {
    if (budget && !budget.take()) break;
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
export async function regionName(loc: LatLng, budget?: Budget): Promise<string | null> {
  const key = `${loc.lat.toFixed(3)}|${loc.lng.toFixed(3)}`;
  const cached = regionCache.get(key);
  if (cached !== undefined) return cached;
  if (budget && !budget.take()) return null;
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
 * [비공식] 카카오맵 장소 상세 원본 JSON.
 * 카카오맵 웹 페이지가 내부적으로 호출하는 엔드포인트로, 예고 없이 바뀌거나 막힐 수 있다.
 * 두 가지 알려진 형태를 순서대로 시도한다. 별점 요약과 상세 화면이 같은 캐시를 쓴다.
 */
// 마지막으로 성공한 엔드포인트를 먼저 시도해서 호출 수를 아낀다
let preferredAttempt = 0;

export async function fetchKakaoRaw(placeId: string, budget?: Budget): Promise<unknown | null> {
  const cached = rawCache.get(placeId);
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

  const order = preferredAttempt === 0 ? attempts : [attempts[preferredAttempt], ...attempts.filter((_, i) => i !== preferredAttempt)];
  for (const a of order) {
    if (budget && !budget.take()) return null; // 예산 소진: 캐시하지 않고 포기
    try {
      const res = await fetchWithTimeout(a.url, {
        headers: { "User-Agent": BROWSER_UA, Accept: "application/json", "Accept-Language": "ko-KR,ko;q=0.9", ...a.headers },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      if (json && typeof json === "object") {
        preferredAttempt = attempts.indexOf(a);
        rawCache.set(placeId, json);
        return json;
      }
    } catch {
      // 다음 형태 시도
    }
  }
  rawCache.set(placeId, null);
  return null;
}

/** [비공식] 카카오맵 별점·후기 요약 (추천 점수용) */
export async function fetchKakaoReviews(placeId: string, budget?: Budget): Promise<KakaoReviewInfo | null> {
  const raw = await fetchKakaoRaw(placeId, budget);
  return raw ? parseKakaoDetail(raw) : null;
}


// ---------- 지역 미리 수집용 ----------

/**
 * [공식] 사각형 안의 음식점/카페 목록 (카테고리 검색).
 * 한 번에 최대 45곳(15 x 3페이지)까지만 주므로, 넘으면 호출하는 쪽에서 사각형을 4등분한다.
 */
export async function categorySearchRect(
  code: "FD6" | "CE7",
  rect: { minLng: number; minLat: number; maxLng: number; maxLat: number },
  page: number,
  budget?: Budget,
): Promise<{ places: BasePlace[]; total: number; isEnd: boolean } | null> {
  if (budget && !budget.take()) return null;
  const params = new URLSearchParams({
    category_group_code: code,
    rect: `${rect.minLng},${rect.minLat},${rect.maxLng},${rect.maxLat}`,
    page: String(page),
    size: "15",
    sort: "accuracy",
  });
  const res = await fetchWithTimeout(`${KAKAO_LOCAL}/search/category.json?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`카카오 카테고리 검색 실패 (${res.status}): ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { documents: KakaoDoc[]; meta: { total_count: number; is_end: boolean } };
  return {
    total: data.meta.total_count,
    isEnd: data.meta.is_end,
    places: data.documents.map((d, i) => ({
      id: d.id,
      name: d.place_name,
      category: d.category_name,
      address: d.address_name,
      roadAddress: d.road_address_name,
      phone: d.phone,
      lat: Number(d.y),
      lng: Number(d.x),
      distance: 0,
      kakaoUrl: d.place_url,
      searchRank: (page - 1) * 15 + i,
      matchedKeywords: [],
    })),
  };
}

export interface RegionHit {
  id: string;
  name: string;
  fullName: string;
  lat: number;
  lng: number;
}

/** [공식] 동 이름으로 지역 찾기 (예: "역삼동", "성수") */
export async function searchRegions(query: string): Promise<RegionHit[]> {
  const params = new URLSearchParams({ query, analyze_type: "similar", size: "15" });
  const res = await fetchWithTimeout(`${KAKAO_LOCAL}/search/address.json?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`카카오 주소 검색 실패 (${res.status})`);
  const data = (await res.json()) as {
    documents: Array<{
      address_name: string;
      address_type: string;
      x: string;
      y: string;
      address: { region_1depth_name: string; region_2depth_name: string; region_3depth_name: string; region_3depth_h_name: string; h_code: string; b_code: string } | null;
    }>;
  };
  const out: RegionHit[] = [];
  const seen = new Set<string>();
  for (const d of data.documents) {
    const a = d.address;
    if (!a) continue;
    const dong = a.region_3depth_h_name || a.region_3depth_name;
    if (!dong) continue;
    const id = a.h_code || a.b_code || `${d.x},${d.y}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: dong,
      fullName: [a.region_1depth_name, a.region_2depth_name, dong].filter(Boolean).join(" "),
      lat: Number(d.y),
      lng: Number(d.x),
    });
  }
  return out;
}

/** [공식] 좌표가 속한 행정동 */
export async function regionAt(loc: LatLng): Promise<RegionHit | null> {
  const res = await fetchWithTimeout(`${KAKAO_LOCAL}/geo/coord2regioncode.json?x=${loc.lng}&y=${loc.lat}`, { headers: authHeaders() });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    documents: Array<{ region_type: string; code: string; region_1depth_name: string; region_2depth_name: string; region_3depth_name: string; x: number; y: number }>;
  };
  const d = data.documents.find((x) => x.region_type === "H") ?? data.documents[0];
  if (!d) return null;
  return {
    id: d.code,
    name: d.region_3depth_name,
    fullName: [d.region_1depth_name, d.region_2depth_name, d.region_3depth_name].filter(Boolean).join(" "),
    lat: d.y || loc.lat,
    lng: d.x || loc.lng,
  };
}
