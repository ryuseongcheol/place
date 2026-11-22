import type { BlogReview, KakaoReviewInfo, MenuItem, ReviewItem } from "./types";
import { collectStrings, deepFind, toNumber } from "./util";

/**
 * 카카오맵 장소 상세 원본(비공식)에서 사진·메뉴·후기·블로그 리뷰·영업시간을 뽑는다.
 * 응답 구조가 시기별로 달라서 키 이름과 경로(예: 'menu', 'photo', 'blog')를 단서로 느슨하게 찾는다.
 */

type Obj = Record<string, unknown>;

function walk(root: unknown, visit: (obj: Obj, path: string) => void, maxDepth = 9) {
  const go = (v: unknown, path: string, d: number) => {
    if (!v || typeof v !== "object" || d > maxDepth) return;
    if (Array.isArray(v)) {
      v.forEach((item) => go(item, path, d + 1));
      return;
    }
    const obj = v as Obj;
    visit(obj, path);
    for (const [k, val] of Object.entries(obj)) go(val, `${path}/${k.toLowerCase()}`, d + 1);
  };
  go(root, "", 0);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function normalizeImageUrl(u: string | null): string | null {
  if (!u) return null;
  let url = u.trim();
  if (url.startsWith("//")) url = `https:${url}`;
  if (url.startsWith("http://")) url = `https://${url.slice(7)}`;
  return /^https:\/\//.test(url) ? url : null;
}

function looksLikeImage(u: string) {
  return /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u) || /(daumcdn|kakaocdn|kakao\.com\/dn|img\d*\.|\/image)/i.test(u);
}

const VIDEO_URL = /\.(mp4|m3u8|mov|webm|avi|mkv)(\?|$)/i;
const DEFAULT_KEYS = ["orgurl", "url", "photo_url", "photoUrl", "image_url", "imageUrl", "img", "image", "thumbnail", "src"];
/** 후기 사진은 작은 썸네일부터 (원본은 크고, 동영상이면 원본 주소가 영상이라 그림이 안 나온다) */
const THUMB_FIRST = ["thumbnail", "thumbnail_url", "thumbnailUrl", "thumb", "small", "url", "photo_url", "photoUrl", "image_url", "imageUrl", "img", "image", "orgurl", "src"];

function firstImage(obj: Obj, keys: string[] = DEFAULT_KEYS): string | null {
  // 동영상 항목은 썸네일만 쓴다
  const isVideo = /video|movie|clip/i.test(String(obj.type ?? obj.media_type ?? obj.mediaType ?? obj.kind ?? obj.category ?? ""));
  for (const k of isVideo ? THUMB_FIRST.filter((x) => !["url", "orgurl", "src"].includes(x)) : keys) {
    const v = normalizeImageUrl(str(obj[k]));
    if (v && looksLikeImage(v) && !VIDEO_URL.test(v)) return v;
  }
  return null;
}

export function extractPhotos(raw: unknown, limit = 15): string[] {
  const out = new Set<string>();
  const main = normalizeImageUrl(str(deepFind(raw, ["mainphotourl", "main_photo_url"])));
  if (main) out.add(main);
  walk(raw, (obj, path) => {
    if (out.size >= limit) return;
    if (!/photo/.test(path) || /(profile|user|owner|writer|blog|comment|review|menu)/.test(path)) return;
    const img = firstImage(obj);
    if (img) out.add(img);
  });
  return [...out].slice(0, limit);
}

function formatPrice(v: unknown): string | null {
  const n = toNumber(v);
  if (n !== null && n > 0) return `${Math.round(n).toLocaleString("ko-KR")}원`;
  const s = str(v);
  return s && s !== "0" ? s : null;
}

/** 메뉴 이름 비교용: 띄어쓰기·기호·[추천] 같은 표시를 빼고 비교 (괄호 안 옵션은 다른 메뉴로 본다) */
export function menuKey(name: string): string {
  return name
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[\s·\-_.,'"!&*★☆~]/g, "")
    .toLowerCase();
}

export function extractMenus(raw: unknown, limit = 40): MenuItem[] {
  const out: MenuItem[] = [];
  // 같은 메뉴가 메뉴판·사진 메뉴 등 여러 곳에 있으면 하나로 합치고, 빠진 사진·가격을 채운다
  const byKey = new Map<string, MenuItem>();
  walk(raw, (obj, path) => {
    if (!/menu/.test(path)) return;
    const name = str(obj.menu) ?? str(obj.name) ?? str(obj.menu_name) ?? str(obj.title);
    if (!name || name.length > 40) return;
    const price = formatPrice(obj.price ?? obj.price_text ?? obj.menu_price);
    if (!price && !("price" in obj)) return; // 메뉴 객체로 보기 어려움
    const key = menuKey(name) || name;
    const image = firstImage(obj);
    const prev = byKey.get(key);
    if (prev) {
      if (!prev.image && image) prev.image = image;
      if (!prev.price && price) prev.price = price;
      return;
    }
    if (out.length >= limit) return;
    const item: MenuItem = { name: name.replace(/\s+/g, " "), price, image };
    byKey.set(key, item);
    out.push(item);
  });
  return out;
}

export function extractKakaoReviews(raw: unknown, limit = 20): ReviewItem[] {
  const out: ReviewItem[] = [];
  const seen = new Set<string>();
  walk(raw, (obj, path) => {
    if (out.length >= limit || /blog/.test(path) || !/(comment|review)/.test(path)) return;
    const text = str(obj.contents) ?? str(obj.content) ?? str(obj.review_text);
    if (!text || text.length < 4 || seen.has(text)) return;
    seen.add(text);
    const rating = toNumber(obj.point ?? obj.star_rating ?? obj.rating ?? obj.score);
    const owner = (obj.owner ?? obj.user ?? obj.writer) as Obj | undefined;
    const photos: string[] = [];
    walk(obj.photoList ?? obj.photos ?? obj.photo_list, (p) => {
      const img = firstImage(p, THUMB_FIRST);
      if (img && photos.length < 4 && !photos.includes(img)) photos.push(img);
    });
    out.push({
      text: text.replace(/\s+/g, " ").slice(0, 500),
      rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
      date: formatDate(obj.date ?? obj.registered_at ?? obj.created_at ?? obj.updated_at),
      author: str(obj.username) ?? str(obj.nickname) ?? (owner ? str(owner.nickname) ?? str(owner.name) : null),
      photos,
    });
  });
  return out;
}

export function extractKakaoBlogReviews(raw: unknown, limit = 10): BlogReview[] {
  const out: BlogReview[] = [];
  const seen = new Set<string>();
  walk(raw, (obj, path) => {
    if (out.length >= limit || !/blog/.test(path)) return;
    const title = str(obj.title);
    const url = normalizeImageUrl(str(obj.outlink) ?? str(obj.url) ?? str(obj.blogurl) ?? str(obj.link)) ?? null;
    if (!title || !url || seen.has(url)) return;
    seen.add(url);
    let thumbnail: string | null = firstImage(obj);
    if (!thumbnail) walk(obj.photoList ?? obj.photos, (p) => (thumbnail ??= firstImage(p)));
    out.push({
      title: stripTags(title),
      snippet: stripTags(str(obj.contents) ?? str(obj.content) ?? str(obj.description) ?? "").slice(0, 200),
      url,
      blogger: str(obj.blogname) ?? str(obj.blog_name) ?? str(obj.author) ?? null,
      date: formatDate(obj.date ?? obj.write_date ?? obj.created_at),
      thumbnail,
      source: "kakao",
    });
  });
  return out;
}

export function extractOpenHours(raw: unknown, limit = 10): string[] {
  const out = new Set<string>();
  walk(raw, (obj, path) => {
    if (out.size >= limit || !/(open|hour|time)/.test(path)) return;
    const day = str(obj.dayOfWeek) ?? str(obj.day_of_week) ?? str(obj.timeName) ?? str(obj.day);
    const time = str(obj.timeSE) ?? str(obj.time) ?? str(obj.hours) ?? str(obj.open_time);
    if (day && time && day !== time) out.add(`${day} ${time}`);
  });
  return [...out];
}

export function extractHomepage(raw: unknown): string | null {
  const v = str(deepFind(raw, ["homepage", "homepage_url", "web_url", "homepageUrl"]));
  if (!v) return null;
  const url = /^https?:\/\//.test(v) ? v : `https://${v}`;
  return /place\.map\.kakao\.com/.test(url) ? null : url;
}

export function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatDate(v: unknown): string | null {
  const s = str(v);
  if (!s) {
    const n = toNumber(v);
    if (n && n > 1e9) return new Date(n > 1e12 ? n : n * 1000).toISOString().slice(0, 10).replace(/-/g, ".");
    return null;
  }
  const m = s.match(/(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : s.slice(0, 20);
}

/** 카카오 상세 원본 → 별점·리뷰 수·후기 요약 (추천 점수용) */
export function parseKakaoDetail(json: unknown): KakaoReviewInfo | null {
  // 신규 형태: { kakaomap_review: { score_set: { average_score, review_count } }, blog_review: { review_count } ... }
  // 구 형태:   { basicInfo: { feedback: { scoresum, scorecnt, comntcnt, blogrvwcnt } }, comment: { list: [{ contents }] } }
  // 같은 이름(review_count, average_score)이 블로그 리뷰·리뷰 작성자 정보에도 있어서
  // 어느 묶음에서 읽을지 정해 두고 얕게만 찾는다 (예전엔 블로그 리뷰 수를 카카오 후기 수로 읽을 수 있었다)
  const root = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const kr = root["kakaomap_review"];
  const br = root["blog_review"];
  const fb = deepFind(json, ["feedback"], 3);
  const num = (v: unknown) => toNumber(v);

  let rating: number | null = null;
  let ratingCount = 0;
  let reviewCount = 0;
  let blogCount = 0;
  if (kr && typeof kr === "object") {
    // kakaomap_review.score_set.{average_score, review_count} (리뷰 목록·작성자 정보까지 내려가지 않게 깊이 1)
    rating = num(deepFind(kr, ["average_score", "averageScore", "avg_score"], 1));
    reviewCount = num(deepFind(kr, ["review_count", "reviewCount", "total_count", "totalCount"], 1)) ?? 0;
    ratingCount = num(deepFind(kr, ["score_count", "scoreCount", "rating_count"], 1)) ?? reviewCount;
  }
  if (br && typeof br === "object") blogCount = num(deepFind(br, ["review_count", "reviewCount", "total_count", "totalCount", "blogrvwcnt"], 1)) ?? 0;
  if (fb && typeof fb === "object") {
    // 예전 형태: basicInfo.feedback.{scoresum, scorecnt, comntcnt, blogrvwcnt}
    const f = fb as Record<string, unknown>;
    const scoresum = num(f.scoresum);
    const scorecnt = num(f.scorecnt);
    if (rating === null && scoresum !== null && scorecnt) rating = scoresum / scorecnt;
    if (!ratingCount && scorecnt) ratingCount = scorecnt;
    if (!reviewCount) reviewCount = num(f.comntcnt) ?? 0;
    if (!blogCount) blogCount = num(f.blogrvwcnt) ?? 0;
  }
  if (!kr && !fb) {
    // 모르는 형태: 예전처럼 전체에서 (블로그 묶음은 빼고)
    const rest = { ...root };
    delete rest["blog_review"];
    rating = num(deepFind(rest, ["average_score", "averageScore", "avg_score"], 3));
    reviewCount = num(deepFind(rest, ["review_count", "comntcnt", "reviewCount", "kakaomap_review_count"], 3)) ?? 0;
  }
  if (!ratingCount) ratingCount = reviewCount;

  const snippets = collectStrings(json, ["contents", "content", "review_text"], 8)
    .filter((s) => s.length >= 8)
    .map((s) => s.replace(/\s+/g, " ").slice(0, 160));

  const tags = collectStrings(json, ["strength_name", "keyword_name", "name"], 30)
    .filter((s) => s.length <= 20)
    .slice(0, 8);

  if (rating === null && !reviewCount && snippets.length === 0) return null;
  return {
    rating: rating !== null ? Math.round(Math.min(5, Math.max(0, rating)) * 10) / 10 : null,
    ratingCount,
    reviewCount,
    blogReviewCount: blogCount,
    snippets,
    tags,
  };
}
