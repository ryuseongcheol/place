import { cacheGet, cachePut } from "./store";
import { fetchWithTimeout, hashKey, haversine, nameSimilarity } from "./util";

/**
 * [공식] Google Places API (New) 텍스트 검색으로 구글 별점·리뷰 수와 리뷰 화면 주소 찾기.
 * GOOGLE_PLACES_API_KEY 가 있을 때만. 결과는 7일 기억 (못 찾은 것은 3일).
 * https://developers.google.com/maps/documentation/places/web-service/text-search
 */
export interface GooglePlaceInfo {
  placeId: string;
  name: string;
  rating: number | null;
  count: number;
  /** 구글 지도의 리뷰 화면 */
  url: string;
}

export const googleEnabled = () => !!process.env.GOOGLE_PLACES_API_KEY;

/**
 * 구글 리뷰 화면 (구글 검색의 리뷰 보기). 휴대폰 브라우저로 열면 google.com/searchviewer/… 리뷰 화면으로 넘어간다.
 * 구글 지도 웹과 달리 "앱으로 열기" 화면 없이 리뷰가 바로 나온다.
 */
export const googleReviewsViewerUrl = (placeId: string) =>
  `https://search.google.com/local/reviews?placeid=${encodeURIComponent(placeId)}&hl=ko&gl=KR`;

/** 키가 없거나 못 찾았을 때: 구글 지도 검색 */
export const googleSearchUrl = (name: string, address?: string | null) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address ?? ""}`.trim())}`;

interface GPlace {
  id: string;
  displayName?: { text?: string };
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  googleMapsLinks?: { reviewsUri?: string };
}

export async function findGooglePlace(name: string, lat: number, lng: number): Promise<GooglePlaceInfo | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  // v2: 짝짓기 기준을 바꿔서 예전에 잘못 붙은 결과를 버린다
  const ck = `gp:v2:${hashKey(`${name}|${lat.toFixed(4)}|${lng.toFixed(4)}`)}`;
  const cached = await cacheGet<{ v: GooglePlaceInfo | null }>(ck);
  if (cached) return cached.v;
  try {
    const res = await fetchWithTimeout(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          // 필요한 필드만 (요금은 필드에 따라 달라진다)
          "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.googleMapsLinks.reviewsUri",
        },
        body: JSON.stringify({
          textQuery: name,
          languageCode: "ko",
          regionCode: "KR",
          maxResultCount: 5,
          locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 300 } },
        }),
      },
      6000,
    );
    if (!res.ok) throw new Error(`google ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const data = (await res.json()) as { places?: GPlace[] };
    let best: { p: GPlace; score: number } | null = null;
    for (const p of data.places ?? []) {
      if (!p.location) continue;
      const dist = haversine({ lat, lng }, { lat: p.location.latitude, lng: p.location.longitude });
      const sim = nameSimilarity(name, p.displayName?.text ?? "");
      // 같은 이름 다른 지점·옆 가게에 붙지 않게: 가까우면서 이름이 비슷해야.
      // (예전엔 40m 안이면 이름이 달라도 인정해서 같은 건물 옆 가게의 별점·리뷰 수가 붙을 수 있었다)
      if (!((sim >= 0.45 && dist <= 250) || (sim >= 0.3 && dist <= 60))) continue;
      const score = sim - dist / 1000;
      if (!best || score > best.score) best = { p, score };
    }
    const v: GooglePlaceInfo | null = best
      ? {
          placeId: best.p.id,
          name: best.p.displayName?.text ?? name,
          rating: typeof best.p.rating === "number" ? best.p.rating : null,
          count: best.p.userRatingCount ?? 0,
          url: best.p.googleMapsLinks?.reviewsUri ?? best.p.googleMapsUri ?? googleSearchUrl(name),
        }
      : null;
    // 리뷰 수가 너무 오래된 값이 되지 않게 7일 (못 찾은 것은 3일)
    await cachePut(ck, { v }, v ? 7 * 86400 : 3 * 86400);
    return v;
  } catch (e) {
    console.error("[google]", e);
    return null;
  }
}
