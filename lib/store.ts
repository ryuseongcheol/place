import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * 작은 키-값 저장소 (고른 지역 목록 등).
 * Cloudflare에서는 KV 바인딩 DATA를 쓰고, 로컬 개발이나 바인딩이 없을 때는 메모리에 둔다.
 * KV 만들기: Cloudflare 대시보드 > Storage & Databases > KV > Create, 그 id를 wrangler.jsonc의 kv_namespaces에 넣는다.
 */
interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

const memory = new Map<string, { v: string; exp: number | null }>();
const memoryKV: KVLike = {
  get: async (k) => {
    const hit = memory.get(k);
    if (!hit) return null;
    if (hit.exp && hit.exp < Date.now()) {
      memory.delete(k);
      return null;
    }
    return hit.v;
  },
  put: async (k, v, opts) => {
    memory.set(k, { v, exp: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null });
  },
};

/** 결과 캐시 (KV). 실패해도 조용히 넘어간다 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const v = await getStore().kv.get(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
export async function cachePut(key: string, value: unknown, ttlSec: number) {
  try {
    await getStore().kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSec) });
  } catch {
    // 무시
  }
}

export function getStore(): { kv: KVLike; persistent: boolean } {
  try {
    const env = getCloudflareContext().env as unknown as { DATA?: KVLike };
    if (env.DATA) return { kv: env.DATA, persistent: true };
  } catch {
    // Cloudflare 밖 (next dev 등)
  }
  return { kv: memoryKV, persistent: false };
}
