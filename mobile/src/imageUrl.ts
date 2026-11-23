/**
 * 사진 주소 고르기: 화면 칸에 맞는 작은 사진을 먼저 받고, 안 되면 다른 주소로 다시 시도한다.
 *
 * - 네이버(pstatic.net): 주소 뒤 type=w320 같은 크기 옵션으로 서버가 줄여서 준다.
 *   블로그 본문 사진(postfiles)·블로그 썸네일(blogthumb)은 네이버 밖에서 바로 부르면 막혀서
 *   같은 경로의 모바일 블로그용 주소(mblogthumb-phinf)로 바꾸거나, 네이버에서 부른 것처럼 Referer 를 붙인다.
 * - 카카오(daumcdn·kakaocdn): 카카오 썸네일 서버(cthumb)로 줄여 받는다.
 * 모두 실패하면 원본 주소로 (그것도 안 되면 SafeImage 가 숨긴다).
 */
export interface ImageSource {
  uri: string;
  headers?: Record<string, string>;
}

/** 서버가 만들어 주는 크기 단계 (화면 크기 × 화면 배율보다 큰 가장 작은 것) */
const BUCKETS = [160, 320, 640, 1080];
function bucket(px: number) {
  return BUCKETS.find((b) => b >= px) ?? 1080;
}

const NAVER_REFERER = { Referer: "https://m.place.naver.com/" };
const BLOG_REFERER = { Referer: "https://m.blog.naver.com/" };
const KAKAO_REFERER = { Referer: "https://place.map.kakao.com/" };

function withType(u: URL, type: string) {
  const x = new URL(u.toString());
  x.searchParams.set("type", type);
  return x.toString();
}

/**
 * @param uri 원래 사진 주소
 * @param sizePt 화면에 그리는 크기(긴 쪽, pt). 화면 배율 3을 곱해 받을 크기를 정한다
 */
export function imageCandidates(uri: string, sizePt = 200): ImageSource[] {
  let u: URL;
  try {
    u = new URL(uri.startsWith("//") ? `https:${uri}` : uri.replace(/^http:\/\//, "https://"));
  } catch {
    return [{ uri }];
  }
  const px = bucket(sizePt * 3);
  const host = u.hostname;
  const out: ImageSource[] = [];

  if (/(^|\.)pstatic\.net$/.test(host)) {
    if (host === "search.pstatic.net") {
      // 네이버 검색의 사진 중계 주소: 크기만 맞춘다
      out.push({ uri: withType(u, `w${px}`) });
    } else if (/^(postfiles|blogthumb|blogfiles)\.pstatic\.net$/.test(host)) {
      // 블로그 사진: 막히지 않는 모바일 블로그 주소로 → 안 되면 블로그에서 부른 것처럼
      const m = new URL(u.toString());
      m.hostname = "mblogthumb-phinf.pstatic.net";
      out.push({ uri: withType(m, `w${px}`) });
      out.push({ uri: withType(u, `w${px}`), headers: BLOG_REFERER });
      out.push({ uri: u.toString(), headers: BLOG_REFERER });
    } else {
      // 리뷰·플레이스 사진(*-phinf): 크기 옵션으로 줄여서
      const headers = /blog/.test(host) ? BLOG_REFERER : NAVER_REFERER;
      out.push({ uri: withType(u, `w${px}`) });
      out.push({ uri: withType(u, `w${px}`), headers });
      out.push({ uri: u.toString(), headers });
    }
  } else if (/(^|\.)(daumcdn\.net|kakaocdn\.net)$/.test(host) && !/\/cthumb\//.test(u.pathname) && !u.searchParams.has("fname")) {
    // 카카오 원본 사진: 카카오 썸네일 서버로 줄여서 (작은 네모 칸은 잘라서 C, 큰 화면은 비율 그대로 높이 기준 R0xN)
    const spec = sizePt <= 150 ? `C${px}x${px}` : `R0x${px}`;
    const fname = uri.startsWith("//") ? `http:${uri}` : uri;
    out.push({ uri: `https://img1.kakaocdn.net/cthumb/local/${spec}.q70/?fname=${encodeURIComponent(fname)}` });
    out.push({ uri: u.toString(), headers: KAKAO_REFERER });
  }

  out.push({ uri: u.toString() });
  // 같은 주소·헤더 빼기
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.uri}|${s.headers?.Referer ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 웹뷰(사진 크게 보기)용: 가장 먼저 시도할 주소와 원본 */
export function largeImage(uri: string) {
  const c = imageCandidates(uri, 400);
  return { first: c[0]?.uri ?? uri, original: c[c.length - 1]?.uri ?? uri };
}
