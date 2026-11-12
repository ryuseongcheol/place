import { attrFit, type Attrs } from "./classify";
import { THEME_PRESETS } from "./themes";
import type { CrawledPlace } from "./types";
import { haversine } from "./util";

/**
 * 수집한 식당(CrawledPlace) ↔ DB 행 변환과 저장 SQL.
 * 서버(D1 바인딩, 매개변수 바인딩)와 야간 수집 스크립트(SQL 파일)가 같은 문장을 쓴다.
 */

export interface PlaceRow {
  id: string;
  name: string;
  category: string;
  address: string;
  road_address: string;
  phone: string;
  lat: number;
  lng: number;
  kakao_url: string;
  rating: number | null;
  rating_count: number;
  review_count: number;
  blog_review_count: number;
  naver_id: string | null;
  naver_visitor_count: number;
  naver_blog_count: number;
  price_level: number | null;
  detail: string;
  attrs: string;
  rule_attrs: string;
  detail_at: number | null;
  detail_failed: number;
  ai_at: number | null;
  updated_at: number;
}

export function toRow(p: CrawledPlace): PlaceRow {
  return {
    id: p.id,
    name: p.name,
    category: p.category ?? "",
    address: p.address ?? "",
    road_address: p.roadAddress ?? "",
    phone: p.phone ?? "",
    lat: p.lat,
    lng: p.lng,
    kakao_url: p.kakaoUrl ?? "",
    rating: p.rating,
    rating_count: p.ratingCount ?? 0,
    review_count: p.reviewCount ?? 0,
    blog_review_count: p.blogReviewCount ?? 0,
    naver_id: p.naverId ?? null,
    naver_visitor_count: p.naverVisitorReviewCount ?? 0,
    naver_blog_count: p.naverBlogReviewCount ?? 0,
    price_level: p.priceLevel,
    detail: JSON.stringify({ menus: p.menus, tags: p.tags, snippets: p.snippets, openHours: p.openHours, naverKeywords: p.naverKeywords ?? [], shows: p.shows ?? [], showsCheckedAt: p.showsCheckedAt ?? null }),
    attrs: JSON.stringify(p.attrs ?? {}),
    rule_attrs: JSON.stringify(p.ruleAttrs ?? p.attrs ?? {}),
    detail_at: p.detailAt,
    detail_failed: p.detailFailed ? 1 : 0,
    ai_at: p.aiAt ?? null,
    updated_at: Date.now(),
  };
}

const parse = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function fromRow(r: PlaceRow, center: { lat: number; lng: number }): CrawledPlace {
  const d = parse<{ menus?: CrawledPlace["menus"]; tags?: string[]; snippets?: string[]; openHours?: string[]; naverKeywords?: string[]; shows?: string[]; showsCheckedAt?: number | null }>(r.detail, {});
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    address: r.address,
    roadAddress: r.road_address,
    phone: r.phone,
    lat: r.lat,
    lng: r.lng,
    distance: Math.round(haversine(center, r)),
    kakaoUrl: r.kakao_url || `https://place.map.kakao.com/${r.id}`,
    searchRank: 0,
    matchedKeywords: [],
    rating: r.rating,
    ratingCount: r.rating_count,
    reviewCount: r.review_count,
    blogReviewCount: r.blog_review_count,
    menus: d.menus ?? [],
    tags: d.tags ?? [],
    snippets: d.snippets ?? [],
    openHours: d.openHours ?? [],
    attrs: parse<Attrs>(r.attrs, {}),
    ruleAttrs: parse<Attrs>(r.rule_attrs, {}),
    priceLevel: r.price_level,
    detailAt: r.detail_at,
    detailFailed: r.detail_failed === 1,
    naverId: r.naver_id,
    naverVisitorReviewCount: r.naver_visitor_count,
    naverBlogReviewCount: r.naver_blog_count,
    naverKeywords: d.naverKeywords ?? [],
    shows: d.shows ?? [],
    showsCheckedAt: d.showsCheckedAt ?? null,
    aiAt: r.ai_at,
  };
}

/** 주제별 적합도 (10 이상만 저장) */
export function themeFits(attrs: Attrs): Array<[string, number]> {
  return THEME_PRESETS.map((t) => [t.id, attrFit(attrs, t.attrs)] as [string, number]).filter(([, f]) => f >= 10);
}

const COLS: Array<keyof PlaceRow> = [
  "id", "name", "category", "address", "road_address", "phone", "lat", "lng", "kakao_url",
  "rating", "rating_count", "review_count", "blog_review_count", "naver_id", "naver_visitor_count", "naver_blog_count",
  "price_level", "detail", "attrs", "rule_attrs", "detail_at", "detail_failed", "ai_at", "updated_at",
];

// 정보 수준: AI 분류 3 + 상세 성공 2. 들어오는 쪽이 같거나 많을 때만 덮어쓴다
const RANK = (t: string) => `((${t}.ai_at IS NOT NULL) * 3 + (${t}.detail_at IS NOT NULL AND ${t}.detail_failed = 0) * 2)`;

export interface Stmt {
  sql: string;
  params: Array<string | number | null>;
}

/** 식당 한 곳 저장 문장들 (식당 → 주제 적합도 → 통계) */
export function upsertStatements(p: CrawledPlace): Stmt[] {
  const row = toRow(p);
  const updates = COLS.filter((c) => c !== "id")
    .map((c) =>
      c === "naver_id"
        ? "naver_id = COALESCE(excluded.naver_id, places.naver_id)"
        : c === "naver_visitor_count" || c === "naver_blog_count"
          ? `${c} = MAX(excluded.${c}, places.${c})`
          : `${c} = excluded.${c}`,
    )
    .join(", ");
  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO places (${COLS.join(", ")}) VALUES (${COLS.map(() => "?").join(", ")}) ON CONFLICT(id) DO UPDATE SET ${updates} WHERE ${RANK("excluded")} >= ${RANK("places")}`,
      params: COLS.map((c) => row[c] as string | number | null),
    },
  ];
  // 주제 적합도: 방금 저장된(또는 남아 있는) 행의 정보 수준이 들어온 것과 같을 때만 다시 계산
  const fits = themeFits(p.attrs as Attrs);
  const guard = `(SELECT ${RANK("places")} FROM places WHERE id = ?) <= ${(p.aiAt ? 3 : 0) + (p.detailAt && !p.detailFailed ? 2 : 0)}`;
  stmts.push({ sql: `DELETE FROM place_themes WHERE place_id = ? AND ${guard}`, params: [p.id, p.id] });
  for (const [themeId, fit] of fits) {
    stmts.push({
      sql: `INSERT INTO place_themes (place_id, theme_id, fit) SELECT ?, ?, ? WHERE ${guard} ON CONFLICT(place_id, theme_id) DO UPDATE SET fit = excluded.fit`,
      params: [p.id, themeId, fit, p.id],
    });
  }
  if (p.detailAt && !p.detailFailed) {
    stmts.push({
      sql: "INSERT OR IGNORE INTO place_stats (place_id, at, rating, review_count, naver_visitor_count, naver_blog_count) VALUES (?, ?, ?, ?, ?, ?)",
      params: [p.id, Math.floor(p.detailAt / 86_400_000) * 86_400_000, p.rating, p.reviewCount, p.naverVisitorReviewCount ?? 0, p.naverBlogReviewCount ?? 0],
    });
  }
  return stmts;
}

/** SQL 파일용: 매개변수를 값으로 풀어 쓴다 */
export function inlineSql(s: Stmt): string {
  let i = 0;
  return (
    s.sql.replace(/\?/g, () => {
      const v = s.params[i++];
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
      return `'${String(v).replace(/'/g, "''")}'`;
    }) + ";"
  );
}
