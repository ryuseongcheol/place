import Constants from "expo-constants";
import type { RecommendResponse } from "./types";

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
