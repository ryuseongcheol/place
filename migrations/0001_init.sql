-- 근처맛집 DB (Cloudflare D1, SQLite). 여러 번 실행해도 안전 (IF NOT EXISTS)

-- 식당: 카카오 place id 기준. 상세·분류값은 JSON 칼럼에 둔다
CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  road_address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  kakao_url TEXT NOT NULL DEFAULT '',
  rating REAL,
  rating_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  blog_review_count INTEGER NOT NULL DEFAULT 0,
  naver_id TEXT,
  naver_visitor_count INTEGER NOT NULL DEFAULT 0,
  naver_blog_count INTEGER NOT NULL DEFAULT 0,
  price_level INTEGER,
  detail TEXT NOT NULL DEFAULT '{}',   -- {menus, tags, snippets, openHours, naverKeywords}
  attrs TEXT NOT NULL DEFAULT '{}',    -- 숨은 분류값 (AI와 섞은 최종)
  rule_attrs TEXT NOT NULL DEFAULT '{}',
  detail_at INTEGER,
  detail_failed INTEGER NOT NULL DEFAULT 0,
  ai_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_places_lat_lng ON places(lat, lng);

-- 주제별 적합도 (0~100). 주제를 바꾸면 다시 계산해서 넣는다
CREATE TABLE IF NOT EXISTS place_themes (
  place_id TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  fit INTEGER NOT NULL,
  PRIMARY KEY (place_id, theme_id)
);
CREATE INDEX IF NOT EXISTS idx_place_themes_theme ON place_themes(theme_id, fit);

-- 별점·리뷰 수 변화 기록 (요즘 뜨는 집 찾기용)
CREATE TABLE IF NOT EXISTS place_stats (
  place_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  rating REAL,
  review_count INTEGER NOT NULL DEFAULT 0,
  naver_visitor_count INTEGER NOT NULL DEFAULT 0,
  naver_blog_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (place_id, at)
);
