import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * 작은 키-값 저장소 (고른 지역 목록 등).
 * Cloudflare에서는 KV 바인딩 DATA를 쓰고, 로컬 개발이나 바인딩이 없을 때는 메모리에 둔다.
 * KV 만들기: Cloudflare 대시보드 > Storage & Databases > KV > Create, 그 id를 wrangler.jsonc의 kv_namespaces에 넣는다.
 */
interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

const memory = new Map<string, string>();
const memoryKV: KVLike = {
  get: async (k) => memory.get(k) ?? null,
  put: async (k, v) => {
    memory.set(k, v);
  },
};

export function getStore(): { kv: KVLike; persistent: boolean } {
  try {
    const env = getCloudflareContext().env as unknown as { DATA?: KVLike };
    if (env.DATA) return { kv: env.DATA, persistent: true };
  } catch {
    // Cloudflare 밖 (next dev 등)
  }
  return { kv: memoryKV, persistent: false };
}
