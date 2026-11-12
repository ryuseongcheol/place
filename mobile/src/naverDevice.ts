import { haversine, nameSimilarity, toNumber } from "./shared";

/**
 * 폰에서 네이버 지도 장소 id 찾기 (비공식 검색).
 * 서버에서 못 찾았을 때 방문자 리뷰 페이지로 바로 가기 위해 쓴다. 실패하면 null.
 */
const cache = new Map<string, string | null>();

export async function resolveNaverPlaceId(p: { id: string; name: string; lat: number; lng: number }): Promise<string | null> {
  if (cache.has(p.id)) return cache.get(p.id) ?? null;
  const params = new URLSearchParams({ query: p.name, type: "all", searchCoord: `${p.lng};${p.lat}`, boundary: "" });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://map.naver.com/p/api/search/allSearch?${params}`, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9",
        Referer: `https://map.naver.com/p/search/${encodeURIComponent(p.name)}`,
        "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { result?: { place?: { list?: Array<Record<string, unknown>> } } };
    const list = json.result?.place?.list ?? [];
    let best: { id: string; score: number } | null = null;
    for (const it of list) {
      const lat = toNumber(it.y);
      const lng = toNumber(it.x);
      const name = typeof it.name === "string" ? it.name : "";
      if (lat === null || lng === null || !it.id) continue;
      const dist = haversine(p, { lat, lng });
      const sim = nameSimilarity(p.name, name);
      if (dist > 200 || sim < 0.55) continue;
      const score = sim - dist / 1000;
      if (!best || score > best.score) best = { id: String(it.id), score };
    }
    cache.set(p.id, best?.id ?? null);
    return best?.id ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function naverVisitorReviewUrl(naverId: string) {
  return `https://m.place.naver.com/restaurant/${naverId}/review/visitor`;
}

/** 장소 id를 못 찾았을 때: 네이버 지도 모바일 검색 (웹뷰에서 가게를 누르면 리뷰 탭으로 보낸다) */
export function naverMapSearchUrl(name: string, area?: string | null) {
  return `https://m.map.naver.com/search2/search.naver?query=${encodeURIComponent(`${area ?? ""} ${name}`.trim())}`;
}
