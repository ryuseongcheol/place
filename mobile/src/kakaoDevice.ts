/**
 * 폰에서 직접 카카오맵 장소 상세(비공식)를 가져온다.
 * 지역 미리 수집 때 수백 곳을 조회해야 해서, 서버(Cloudflare 호출 한도·데이터센터 IP 차단)보다 폰이 유리하다.
 * 연속으로 실패하면 막힌 것으로 보고 서버 경로(/api/crawl/detail)로 넘어간다.
 */
const UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const attempts = (id: string): Array<{ url: string; headers: Record<string, string> }> => [
  {
    url: `https://place-api.map.kakao.com/places/panel3/${id}`,
    headers: { pf: "web", Referer: `https://place.map.kakao.com/${id}`, Origin: "https://place.map.kakao.com" },
  },
  { url: `https://place.map.kakao.com/main/v/${id}`, headers: { Referer: `https://place.map.kakao.com/${id}` } },
];

let preferred = 0;
let consecutiveFailures = 0;
let everSucceeded = false;

/** 폰에서 직접 가져오기가 막힌 것으로 보이는지 */
export function deviceKakaoBlocked() {
  return !everSucceeded && consecutiveFailures >= 6;
}

async function fetchJson(url: string, headers: Record<string, string>, timeoutMs = 8000): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "ko-KR,ko;q=0.9", ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as unknown;
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchKakaoRawDevice(id: string): Promise<unknown | null> {
  const list = attempts(id);
  const order = preferred === 0 ? list : [list[preferred], ...list.filter((_, i) => i !== preferred)];
  for (const a of order) {
    const j = await fetchJson(a.url, a.headers);
    if (j) {
      preferred = list.indexOf(a);
      consecutiveFailures = 0;
      everSucceeded = true;
      return j;
    }
  }
  consecutiveFailures++;
  return null;
}
