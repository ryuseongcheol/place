import Constants from "expo-constants";
import type { AiClassifyInput, BasePlace, CrawlCursor, CrawledPlace, ScoredPlace, CrawlDetailItem, CrawlListResponse, PlaceDetail, RecommendResponse, Region } from "./types";

export interface PresetChip {
  id: string;
  label: string;
  emoji: string;
}

/**
 * 추천 API 서버 주소.
 * 1) EXPO_PUBLIC_API_URL 이 있으면 그것
 * 2) 개발 중이면 Expo 개발 서버를 띄운 PC의 IP + :3000 (같은 와이파이의 실기기에서도 동작)
 */
function resolveApiBase(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, "");
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (__DEV__ && host) return `http://${host}:3000`;
  return "http://localhost:3000";
}

export const API_BASE = resolveApiBase();

async function request<T>(path: string, init?: RequestInit, timeoutMs = 45000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal });
    const json = await res.json().catch(() => ({}));
    if (res.status === 404 && !(json as { error?: string }).error) {
      throw new Error("서버에 이 기능이 아직 없어요. 서버가 최신 버전으로 배포됐는지 확인해 주세요. (404)");
    }
    if (!res.ok) throw new Error((json as { error?: string }).error ?? `서버 오류 (${res.status})`);
    return json as T;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("서버 응답이 너무 오래 걸려요.");
    if (e instanceof TypeError) throw new Error(`서버(${API_BASE})에 연결할 수 없어요.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function fetchThemes() {
  return request<{ presets: PresetChip[]; ai: boolean; mock: boolean }>("/api/themes", undefined, 10000);
}

export function fetchRecommendations(body: {
  lat: number;
  lng: number;
  radius: number;
  presetId: string | null;
  text: string | null;
}) {
  return request<RecommendResponse>("/api/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchPlaceDetail(p: { id: string; name: string; lat: number; lng: number; naverId: string | null }) {
  const qs = new URLSearchParams({ name: p.name, lat: String(p.lat), lng: String(p.lng) });
  if (p.naverId) qs.set("naverId", p.naverId);
  return request<PlaceDetail>(`/api/place/${encodeURIComponent(p.id)}?${qs}`, undefined, 30000);
}

export type RegionHit = Omit<Region, "radius">;

export function searchRegions(q: string) {
  return request<{ regions: RegionHit[] }>(`/api/regions?q=${encodeURIComponent(q)}`, undefined, 15000);
}

export function regionAtLocation(lat: number, lng: number) {
  return request<{ regions: RegionHit[] }>(`/api/regions?lat=${lat}&lng=${lng}`, undefined, 15000);
}

export function crawlList(region: Region, cursor: CrawlCursor | null) {
  return request<CrawlListResponse>("/api/crawl/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region, cursor }),
  }, 60000);
}

export function crawlDetail(places: Array<Pick<BasePlace, "id" | "name" | "category">>) {
  return request<{ items: CrawlDetailItem[] }>("/api/crawl/detail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ places }),
  }, 60000);
}

export function crawlAi(places: AiClassifyInput[]) {
  return request<{ items: Array<{ id: string; attrs: Partial<Record<string, number>> }> }>("/api/crawl/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ places }),
  }, 120000);
}

/** 고른 지역 목록을 서버에 저장 (매일 밤 서버 수집 대상). 서버에 저장소가 없으면 조용히 실패 */
export function syncRegionsToServer(regions: Region[]) {
  return request<{ ok: boolean }>("/api/sync/regions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ regions }),
  }, 15000);
}

/** 서버 DB에서 위치·주제/검색어로 추천 */
export function searchDb(p: { lat: number; lng: number; radius: number; themeId?: string | null; q?: string | null }) {
  const qs = new URLSearchParams({ lat: String(p.lat), lng: String(p.lng), radius: String(p.radius) });
  if (p.themeId) qs.set("theme", p.themeId);
  if (p.q) qs.set("q", p.q);
  return request<{ places: ScoredPlace[]; inArea: number; analyzed: number }>(`/api/db/search?${qs}`, undefined, 20000);
}

/** 기기에서 수집한 식당을 서버 DB에 올림 */
export function uploadPlaces(places: CrawledPlace[]) {
  return request<{ ok: boolean; saved: number }>("/api/db/places", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ places }),
  }, 30000);
}

/** 수집한 식당들의 방송·가이드 출연 확인 (서버가 네이버 블로그 검색) */
export function crawlShows(region: Region, places: Array<Pick<CrawledPlace, "id" | "name">>) {
  return request<{ items: Array<{ id: string; shows: string[] }> }>("/api/crawl/shows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region: { lat: region.lat, lng: region.lng }, places: places.map((p) => ({ id: p.id, name: p.name })) }),
  }, 60000);
}
