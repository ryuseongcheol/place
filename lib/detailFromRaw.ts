import { classify } from "./classify";
import { extractKakaoReviews, extractMenus, extractOpenHours, parseKakaoDetail } from "./kakaoDetail";
import type { BasePlace, CrawlDetailItem } from "./types";

/** 카카오 상세 원본(없으면 이름·카테고리만) → 저장용 요약 + 숨은 분류값. 서버와 앱이 같이 쓴다. */
export function detailFromRaw(p: Pick<BasePlace, "id" | "name" | "category">, raw: unknown | null): CrawlDetailItem {
  const summary = raw ? parseKakaoDetail(raw) : null;
  const menus = raw ? extractMenus(raw).slice(0, 12) : [];
  const reviews = raw ? extractKakaoReviews(raw) : [];
  const openHours = raw ? extractOpenHours(raw) : [];
  const tags = summary?.tags ?? [];
  const snippets = reviews.map((r) => r.text);
  const { attrs, priceLevel } = classify({
    name: p.name,
    category: p.category,
    menus,
    tags,
    snippets,
    openHours,
    rating: summary?.rating ?? null,
    ratingCount: summary?.ratingCount ?? 0,
    reviewCount: summary?.reviewCount ?? 0,
    blogReviewCount: summary?.blogReviewCount ?? 0,
  });
  return {
    id: p.id,
    ok: Boolean(raw),
    rating: summary?.rating ?? null,
    ratingCount: summary?.ratingCount ?? 0,
    reviewCount: summary?.reviewCount ?? 0,
    blogReviewCount: summary?.blogReviewCount ?? 0,
    menus: menus.slice(0, 8),
    tags: tags.slice(0, 8),
    snippets: snippets.slice(0, 3).map((s) => s.slice(0, 120)),
    openHours: openHours.slice(0, 4),
    attrs,
    priceLevel,
  };
}
