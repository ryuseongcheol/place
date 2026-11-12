import { classify } from "./classify";
import { extractKakaoReviews, extractMenus, extractOpenHours, parseKakaoDetail } from "./kakaoDetail";
import type { BasePlace, CrawlDetailItem } from "./types";

/** 카카오 외에 함께 반영할 정보 (네이버 키워드 리뷰·리뷰 수) */
export interface ExtraSignals {
  keywords?: string[];
  visitorReviewCount?: number;
  blogReviewCount?: number;
}

/** 카카오 상세 원본(없으면 이름·카테고리만) → 저장용 요약 + 숨은 분류값. 서버와 앱이 같이 쓴다. */
export function detailFromRaw(p: Pick<BasePlace, "id" | "name" | "category">, raw: unknown | null, extra: ExtraSignals = {}): CrawlDetailItem {
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
    // 네이버 키워드 리뷰("혼밥하기 좋아요", "주차하기 편해요")는 강점 태그처럼 강하게 반영
    tags: [...tags, ...(extra.keywords ?? [])],
    snippets,
    openHours,
    rating: summary?.rating ?? null,
    ratingCount: summary?.ratingCount ?? 0,
    reviewCount: (summary?.reviewCount ?? 0) + (extra.visitorReviewCount ?? 0),
    blogReviewCount: (summary?.blogReviewCount ?? 0) + (extra.blogReviewCount ?? 0),
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
    snippets: snippets.slice(0, 8).map((s) => s.slice(0, 180)),
    openHours: openHours.slice(0, 4),
    attrs,
    priceLevel,
  };
}
