import { useEffect, useState } from "react";
import { fetchPlaceDetail } from "./api";
import type { PlaceDetail, ScoredPlace } from "./types";

/**
 * 식당 상세(사진·메뉴·후기) 기억해 두기. 카드 목록과 상세 화면이 같이 쓴다.
 * 같은 식당을 동시에 여러 번 부르면 한 번만 요청하고, 30분 동안 다시 쓴다.
 */
const TTL = 30 * 60 * 1000;
const MAX = 80;
const cache = new Map<string, { at: number; p: Promise<PlaceDetail>; value?: PlaceDetail }>();

type Key = Pick<ScoredPlace, "id" | "name" | "lat" | "lng"> & { naver?: ScoredPlace["naver"] };

export function getDetail(p: Key): Promise<PlaceDetail> {
  const hit = cache.get(p.id);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const entry: { at: number; p: Promise<PlaceDetail>; value?: PlaceDetail } = { at: Date.now(), p: Promise.resolve(null as never) };
  entry.p = fetchPlaceDetail({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, naverId: p.naver?.naverId ?? null })
    .then((d) => {
      entry.value = d;
      return d;
    })
    .catch((e) => {
      cache.delete(p.id); // 실패한 건 다음에 다시
      throw e;
    });
  cache.set(p.id, entry);
  while (cache.size > MAX) cache.delete(cache.keys().next().value as string);
  return entry.p;
}

/** 이미 받아 둔 상세 (없으면 null, 요청하지 않음) */
export function peekDetail(id: string): PlaceDetail | null {
  return cache.get(id)?.value ?? null;
}

/** 상세 불러오기 훅. enabled=false 면 요청하지 않고 받아 둔 것만 */
export function useDetail(p: Key | null, enabled = true) {
  const [detail, setDetail] = useState<PlaceDetail | null>(() => (p ? peekDetail(p.id) : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!p) return;
    let alive = true;
    const cached = peekDetail(p.id);
    setDetail(cached);
    setError(null);
    if (cached || !enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getDetail(p)
      .then((d) => alive && setDetail(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, enabled]);
  return { detail, error, loading };
}
