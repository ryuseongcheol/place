import type { LatLng } from "./types";

/** 간단한 TTL 메모리 캐시 (서버 프로세스 단위). 외부 사이트 호출 횟수를 줄이기 위함. */
export class TTLCache<V> {
  private store = new Map<string, { value: V; expires: number }>();
  constructor(private ttlMs: number, private maxSize = 2000) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V) {
    if (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}

/** 동시 실행 수 제한 map */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 6000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 장소명 비교용 정규화: 공백/특수문자 제거, 지점명 괄호 제거, 소문자 */
export function normalizeName(name: string): string {
  return name
    .replace(/<[^>]+>/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[\s·\-_.,'"!&]/g, "")
    .toLowerCase();
}

/** 두 장소명이 같은 가게를 가리키는지 대략 판단 (0~1) */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  // 바이그램 Dice 계수
  const grams = (s: string) => {
    const g = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const k = s.slice(i, i + 2);
      g.set(k, (g.get(k) ?? 0) + 1);
    }
    return g;
  };
  const gx = grams(x);
  const gy = grams(y);
  let overlap = 0;
  for (const [k, n] of gx) overlap += Math.min(n, gy.get(k) ?? 0);
  const total = Math.max(1, x.length - 1 + (y.length - 1));
  return (2 * overlap) / total;
}

export function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 비공식 응답은 구조가 자주 바뀌므로, 키 이름 후보로 깊이 탐색해 첫 번째 값을 찾는다.
 */
export function deepFind(obj: unknown, keys: string[], maxDepth = 6): unknown {
  const wanted = new Set(keys);
  const queue: Array<{ v: unknown; d: number }> = [{ v: obj, d: 0 }];
  while (queue.length) {
    const { v, d } = queue.shift()!;
    if (!v || typeof v !== "object" || d > maxDepth) continue;
    if (Array.isArray(v)) {
      for (const item of v) queue.push({ v: item, d: d + 1 });
      continue;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (wanted.has(k) && val !== null && val !== undefined && val !== "") return val;
    }
    for (const val of Object.values(v as Record<string, unknown>)) queue.push({ v: val, d: d + 1 });
  }
  return undefined;
}

/** 객체 트리 안에서 특정 문자열 필드를 가진 객체들의 해당 값을 모은다 (리뷰 본문 수집용). */
export function collectStrings(obj: unknown, fieldNames: string[], limit = 10, maxDepth = 7): string[] {
  const wanted = new Set(fieldNames);
  const out: string[] = [];
  const walk = (v: unknown, d: number) => {
    if (out.length >= limit || !v || typeof v !== "object" || d > maxDepth) return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, d + 1);
      return;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (out.length >= limit) return;
      if (wanted.has(k) && typeof val === "string" && val.trim().length >= 2) out.push(val.trim());
      else if (val && typeof val === "object") walk(val, d + 1);
    }
  };
  walk(obj, 0);
  return [...new Set(out)];
}

/** 짧은 해시 (캐시 키용, FNV-1a) */
export function hashKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
