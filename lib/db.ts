import { getCloudflareContext } from "@opennextjs/cloudflare";
import { rankByText, rankByTheme } from "./rankCrawled";
import { fromRow, upsertStatements, type PlaceRow } from "./placeRow";
import { getPreset } from "./themes";
import type { CrawledPlace, ScoredPlace } from "./types";
import { haversine } from "./util";

/** Cloudflare D1 (바인딩 DB). wrangler.jsonc의 d1_databases 참고 */
interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  all<T = unknown>(): Promise<{ results: T[] }>;
  first<T = unknown>(): Promise<T | null>;
}
interface D1 {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<unknown[]>;
}

export function getDb(): D1 | null {
  try {
    const env = getCloudflareContext().env as unknown as { DB?: D1 };
    return env.DB ?? null;
  } catch {
    return null;
  }
}

// migrations/0001_init.sql 과 같은 내용 (앱 업로드가 먼저 와도 테이블이 있도록)
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS places (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', road_address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', lat REAL NOT NULL, lng REAL NOT NULL, kakao_url TEXT NOT NULL DEFAULT '', rating REAL, rating_count INTEGER NOT NULL DEFAULT 0, review_count INTEGER NOT NULL DEFAULT 0, blog_review_count INTEGER NOT NULL DEFAULT 0, naver_id TEXT, naver_visitor_count INTEGER NOT NULL DEFAULT 0, naver_blog_count INTEGER NOT NULL DEFAULT 0, price_level INTEGER, detail TEXT NOT NULL DEFAULT '{}', attrs TEXT NOT NULL DEFAULT '{}', rule_attrs TEXT NOT NULL DEFAULT '{}', detail_at INTEGER, detail_failed INTEGER NOT NULL DEFAULT 0, ai_at INTEGER, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_places_lat_lng ON places(lat, lng)`,
  `CREATE TABLE IF NOT EXISTS place_themes (place_id TEXT NOT NULL, theme_id TEXT NOT NULL, fit INTEGER NOT NULL, PRIMARY KEY (place_id, theme_id))`,
  `CREATE INDEX IF NOT EXISTS idx_place_themes_theme ON place_themes(theme_id, fit)`,
  `CREATE TABLE IF NOT EXISTS place_stats (place_id TEXT NOT NULL, at INTEGER NOT NULL, rating REAL, review_count INTEGER NOT NULL DEFAULT 0, naver_visitor_count INTEGER NOT NULL DEFAULT 0, naver_blog_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (place_id, at))`,
];
let schemaReady = false;

export async function ensureSchema(db: D1) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}

export async function upsertPlaces(db: D1, places: CrawledPlace[]) {
  await ensureSchema(db);
  const stmts = places.flatMap(upsertStatements).map((s) => db.prepare(s.sql).bind(...s.params));
  // D1 batch는 한 번에 너무 크면 실패하므로 나눠서
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
}

function bbox(lat: number, lng: number, radius: number) {
  const dLat = radius / 111_000;
  const dLng = radius / (111_000 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lat + dLat, lng - dLng, lng + dLng];
}

export interface DbSearch {
  lat: number;
  lng: number;
  radius: number;
  themeId?: string | null;
  q?: string | null;
}

/**
 * DB에서 위치·주제(또는 검색어)로 추천. 주제는 미리 계산한 적합도로 먼저 좁히고,
 * 최종 순위는 앱과 같은 rankCrawled 로 낸다.
 */
export async function searchDb(db: D1, s: DbSearch): Promise<{ places: ScoredPlace[]; inArea: number; analyzed: number }> {
  await ensureSchema(db);
  const [minLat, maxLat, minLng, maxLng] = bbox(s.lat, s.lng, s.radius);
  const center = { lat: s.lat, lng: s.lng };

  const counts = await db
    .prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN detail_at IS NOT NULL THEN 1 ELSE 0 END) AS d FROM places WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?")
    .bind(minLat, maxLat, minLng, maxLng)
    .first<{ n: number; d: number | null }>();

  let rows: PlaceRow[];
  const theme = getPreset(s.themeId);
  const q = s.q?.trim();
  if (q) {
    const likes = q
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .map((t) => `%${t.replace(/[%_]/g, "")}%`);
    const cond = likes.map(() => "(name LIKE ? OR category LIKE ? OR detail LIKE ?)").join(" OR ");
    rows = (
      await db
        .prepare(`SELECT * FROM places WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND (${cond}) LIMIT 400`)
        .bind(minLat, maxLat, minLng, maxLng, ...likes.flatMap((l) => [l, l, l]))
        .all<PlaceRow>()
    ).results;
    // 검색어가 분류값·주제 이름일 수도 있으니 (예: "혼밥", "주차") 일치가 적으면 지역 전체에서도 본다
    if (rows.length < 20) {
      const more = (
        await db.prepare("SELECT * FROM places WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND detail_at IS NOT NULL ORDER BY review_count + naver_visitor_count DESC LIMIT 400").bind(minLat, maxLat, minLng, maxLng).all<PlaceRow>()
      ).results;
      const seen = new Set(rows.map((r) => r.id));
      rows = [...rows, ...more.filter((r) => !seen.has(r.id))];
    }
  } else if (theme) {
    rows = (
      await db
        .prepare(
          "SELECT p.* FROM place_themes t JOIN places p ON p.id = t.place_id WHERE t.theme_id = ? AND t.fit >= 25 AND p.lat BETWEEN ? AND ? AND p.lng BETWEEN ? AND ? ORDER BY t.fit DESC LIMIT 400",
        )
        .bind(theme.id, minLat, maxLat, minLng, maxLng)
        .all<PlaceRow>()
    ).results;
  } else return { places: [], inArea: counts?.n ?? 0, analyzed: counts?.d ?? 0 };

  const places = rows.map((r) => fromRow(r, center)).filter((p) => haversine(center, p) <= s.radius);
  const ranked = q ? rankByText(places, q, center) : rankByTheme(places, theme!, center);
  return { places: ranked, inArea: counts?.n ?? 0, analyzed: counts?.d ?? 0 };
}
