import { Budget } from "./budget";
import { detailFromRaw } from "./detailFromRaw";
import { categorySearchRect, fetchKakaoRaw } from "./kakao";
export { detailFromRaw };
import type { BasePlace, CrawlCursor, CrawlDetailItem, CrawlListResponse, CrawlRect, Region } from "./types";
import { haversine } from "./util";

const MAX_DEPTH = 6; // 사각형을 4등분하는 최대 깊이 (약 1/4096 크기까지)

/** 지역(중심+반경)을 덮는 첫 사각형들: 음식점 + 카페 */
export function initialCursor(region: Pick<Region, "lat" | "lng" | "radius">): CrawlCursor {
  const dLat = region.radius / 111_000;
  const dLng = region.radius / (111_000 * Math.cos((region.lat * Math.PI) / 180));
  const base = { minLng: region.lng - dLng, minLat: region.lat - dLat, maxLng: region.lng + dLng, maxLat: region.lat + dLat, depth: 0, page: 1 };
  return { queue: [{ ...base, code: "FD6" }, { ...base, code: "CE7" }] };
}

function split(r: CrawlRect): CrawlRect[] {
  const midLng = (r.minLng + r.maxLng) / 2;
  const midLat = (r.minLat + r.maxLat) / 2;
  const d = r.depth + 1;
  return [
    { ...r, maxLng: midLng, maxLat: midLat, depth: d, page: 1 },
    { ...r, minLng: midLng, maxLat: midLat, depth: d, page: 1 },
    { ...r, maxLng: midLng, minLat: midLat, depth: d, page: 1 },
    { ...r, minLng: midLng, minLat: midLat, depth: d, page: 1 },
  ];
}

/**
 * 목록 수집 한 덩어리. 호출 예산 안에서 사각형 큐를 처리하고, 남은 큐를 커서로 돌려준다.
 * 상태를 서버에 저장하지 않으므로 앱이 커서를 들고 다시 부른다.
 */
export async function crawlListChunk(region: Region, cursor: CrawlCursor | null, budget: Budget): Promise<CrawlListResponse> {
  const queue = [...(cursor ?? initialCursor(region)).queue];
  const found = new Map<string, BasePlace>();
  const start = budget.remaining;
  const center = { lat: region.lat, lng: region.lng };

  while (queue.length && budget.remaining > 0) {
    const r = queue.shift()!;
    const res = await categorySearchRect(r.code, r, r.page, budget);
    if (!res) {
      queue.unshift(r); // 예산 소진: 다음 요청에서 이어서
      break;
    }
    // 45곳을 넘는 사각형은 첫 페이지에서 4등분 (첫 페이지 결과도 버리지 않음)
    if (r.page === 1 && res.total > 45 && r.depth < MAX_DEPTH) {
      queue.push(...split(r));
    } else if (!res.isEnd && r.page < 3) {
      queue.unshift({ ...r, page: r.page + 1 });
    }
    for (const p of res.places) {
      const d = Math.round(haversine(center, p));
      if (d <= region.radius) found.set(p.id, { ...p, distance: d });
    }
  }
  return { places: [...found.values()], cursor: queue.length ? { queue } : null, calls: start - budget.remaining };
}

/** 식당 상세(비공식) → 숨은 분류값. 앱이 직접 못 가져올 때 쓰는 서버 경로 */
export async function crawlDetailChunk(places: Array<Pick<BasePlace, "id" | "name" | "category">>, budget: Budget): Promise<CrawlDetailItem[]> {
  const out: CrawlDetailItem[] = [];
  for (const p of places) {
    const raw = /^\d+$/.test(p.id) ? await fetchKakaoRaw(p.id, budget) : null;
    out.push(detailFromRaw(p, raw));
  }
  return out;
}

