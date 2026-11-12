/**
 * 매일 밤 서버 수집 (GitHub Actions에서 실행).
 * 앱이 서버에 저장한 지역 목록(/api/sync/regions)을 받아 지역마다
 *   목록(카카오 공식) → 상세(카카오 비공식 + 네이버) → AI 분류
 * 를 하고 region-data/region-<id>.json 으로 저장한다. 워크플로가 이 파일을 GitHub Release에 올리면
 * 앱이 받아서 기기 데이터와 합친다 (src/crawlEngine.ts syncRemote).
 *
 * 이전 결과(region-data/)가 있으면 이어서: 새 식당과 오래된(14일) 식당만 다시 상세 조회, AI는 바뀐 곳만.
 *
 * 실행: npx tsx scripts/crawl-regions.ts
 * 환경변수: KAKAO_REST_API_KEY (필수), ANTHROPIC_API_KEY·CLAUDE_MODEL (AI 분류), API_BASE (기본 workers.dev 주소)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aiClassify, aiClassifyEnabled } from "../lib/aiClassify";
import { Budget } from "../lib/budget";
import { classify, mergeAttrs, type Attrs } from "../lib/classify";
import { crawlListChunk } from "../lib/crawl";
import { detailFromRaw } from "../lib/detailFromRaw";
import { fetchKakaoRaw } from "../lib/kakao";
import { matchNaver, naverMapSearch, naverSearchEnabled, naverShowSearch } from "../lib/naver";
import { applyShows, mergeShows } from "../lib/shows";
import { inlineSql, upsertStatements } from "../lib/placeRow";
import type { AiClassifyInput, BasePlace, CrawlCursor, CrawledPlace, Region, RegionFile } from "../lib/types";
import { haversine, mapLimit } from "../lib/util";

const API_BASE = (process.env.API_BASE || "https://place.spikeryu.workers.dev").replace(/\/$/, "");
const OUT_DIR = "region-data";
const FILE_VERSION = 1;
const MAX_DETAIL = 1200;
const STALE_MS = 14 * 24 * 60 * 60 * 1000;
const AI_BATCH = 20;

const safeId = (id: string) => id.replace(/[^\w-]/g, "_");
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

function fromBase(p: BasePlace, region: Region): CrawledPlace {
  const { attrs } = classify({ name: p.name, category: p.category });
  return {
    ...p,
    distance: Math.round(haversine(region, p)),
    rating: null,
    ratingCount: 0,
    reviewCount: 0,
    blogReviewCount: 0,
    menus: [],
    tags: [],
    snippets: [],
    openHours: [],
    attrs,
    ruleAttrs: attrs,
    priceLevel: null,
    detailAt: null,
  };
}

function aiInput(p: CrawledPlace): AiClassifyInput {
  return {
    id: p.id,
    name: p.name.slice(0, 80),
    category: p.category.slice(0, 120),
    priceLevel: p.priceLevel,
    menus: p.menus.slice(0, 10).map((m) => `${m.name}${m.price ? ` ${m.price}` : ""}`.slice(0, 60)),
    tags: [...p.tags, ...(p.naverKeywords ?? [])].slice(0, 16).map((t) => t.slice(0, 40)),
    reviews: p.snippets.slice(0, 8).map((r) => r.slice(0, 200)),
    openHours: p.openHours.slice(0, 4).map((h) => h.slice(0, 60)),
  };
}

async function crawlRegion(region: Region) {
  const file = join(OUT_DIR, `region-${safeId(region.id)}.json`);
  const prev: RegionFile | null = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const places: Record<string, CrawledPlace> = prev?.places ?? {};
  log(`== ${region.fullName} (이전 ${Object.keys(places).length}곳)`);

  // 1) 목록: 매번 새로 훑어 새로 생긴 가게를 잡는다
  let cursor: CrawlCursor | null = null;
  let found = 0;
  do {
    const res = await crawlListChunk(region, cursor, new Budget(400));
    for (const p of res.places) {
      found++;
      if (!places[p.id]) places[p.id] = fromBase(p, region);
      else places[p.id] = { ...places[p.id], name: p.name, category: p.category, phone: p.phone, roadAddress: p.roadAddress, address: p.address };
    }
    cursor = res.cursor;
  } while (cursor);
  log(`목록 ${found}곳 (누적 ${Object.keys(places).length}곳)`);

  // 2) 상세: 새 가게 + 오래된 가게 + 실패했던 가게
  const targets = Object.values(places)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_DETAIL)
    .filter((p) => !p.detailAt || p.detailFailed || Date.now() - p.detailAt > STALE_MS);
  let ok = 0;
  let fail = 0;
  let naverOk = 0;
  let blocked = false;
  await mapLimit(targets, 6, async (p, idx) => {
    if (blocked) return;
    const [raw, naverPool] = await Promise.all([fetchKakaoRaw(p.id), naverMapSearch(p.name, p)]);
    const naver = matchNaver(p, naverPool);
    if (raw) ok++;
    else fail++;
    if (naver) naverOk++;
    // 처음 40곳이 거의 다 실패하면 이 서버 IP가 막힌 것: 이전 결과를 지키고 상세는 건너뛴다
    if (idx === 40 && ok < 4) {
      blocked = true;
      log("카카오 상세가 막힌 것 같아 이번 실행은 상세를 건너뜁니다");
      return;
    }
    if (!raw && p.detailAt && !p.detailFailed) return; // 이전 성공 결과 유지
    const extra = naver ? { keywords: naver.keywords, visitorReviewCount: naver.visitorReviewCount, blogReviewCount: naver.blogReviewCount } : {};
    const d = detailFromRaw(p, raw, extra);
    places[p.id] = {
      ...p,
      naverId: naver?.naverId ?? p.naverId ?? null,
      naverVisitorReviewCount: naver?.visitorReviewCount ?? p.naverVisitorReviewCount ?? 0,
      naverBlogReviewCount: naver?.blogReviewCount ?? p.naverBlogReviewCount ?? 0,
      naverKeywords: naver?.keywords ?? p.naverKeywords ?? [],
      rating: d.rating,
      ratingCount: d.ratingCount,
      reviewCount: d.reviewCount,
      blogReviewCount: d.blogReviewCount,
      menus: d.menus,
      tags: d.tags,
      snippets: d.snippets,
      openHours: d.openHours,
      attrs: d.attrs,
      ruleAttrs: d.attrs,
      priceLevel: d.priceLevel,
      detailAt: Date.now(),
      detailFailed: !d.ok,
      aiAt: null,
      shows: mergeShows(p.shows, d.shows),
    };
  });
  log(`상세 대상 ${targets.length}곳: 카카오 성공 ${ok} / 실패 ${fail}, 네이버 매칭 ${naverOk}`);

  // 3) 방송·가이드 출연 확인 (네이버 블로그 검색): 처음이거나 30일 지난 곳
  if (naverSearchEnabled()) {
    const showTargets = Object.values(places).filter((p) => p.detailAt && (!p.showsCheckedAt || Date.now() - p.showsCheckedAt > 30 * 86_400_000));
    let found = 0;
    await mapLimit(showTargets, 6, async (p) => {
      const shows = await naverShowSearch(p.name, region.name);
      if (shows === null) return;
      places[p.id] = applyShows(places[p.id], shows);
      if (shows.length) found++;
    });
    log(`방송 출연 확인 ${showTargets.length}곳 → 출연 ${found}곳`);
  } else log("네이버 검색 키 없음: 블로그로 방송 출연 확인은 건너뜀 (카카오 상세에서 찾은 것만)");

  // 4) AI 분류: 상세가 새로 바뀐 곳만
  if (aiClassifyEnabled()) {
    const aiTargets = Object.values(places).filter((p) => p.detailAt && !p.aiAt);
    let done = 0;
    for (let i = 0; i < aiTargets.length; i += AI_BATCH) {
      const batch = aiTargets.slice(i, i + AI_BATCH);
      try {
        const res = await aiClassify(batch.map(aiInput));
        for (const it of res) {
          const p = places[it.id];
          if (!p) continue;
          places[it.id] = { ...p, attrs: mergeAttrs((p.ruleAttrs ?? p.attrs) as Attrs, it.attrs), aiAt: Date.now() };
          done++;
        }
      } catch (e) {
        log("AI 분류 실패:", e instanceof Error ? e.message : e);
      }
    }
    log(`AI 분류 ${done}/${aiTargets.length}곳`);
  } else log("ANTHROPIC_API_KEY 없음: AI 분류 건너뜀");

  const out: RegionFile = {
    version: FILE_VERSION,
    region,
    places,
    listCursor: null,
    listStarted: true,
    listDone: true,
    doneAt: Date.now(),
  };
  writeFileSync(file, JSON.stringify(out));
  // DB(D1)에 넣을 SQL: 워크플로가 wrangler d1 execute 로 실행
  const sql = Object.values(places).flatMap(upsertStatements).map(inlineSql).join("\n");
  writeFileSync(join(OUT_DIR, `upsert-${safeId(region.id)}.sql`), sql);
  log(`저장: ${file} (+ DB용 SQL)`);
}

async function main() {
  if (!process.env.KAKAO_REST_API_KEY) {
    console.error("KAKAO_REST_API_KEY가 없습니다. GitHub 저장소 Settings > Secrets and variables > Actions 에 등록하세요.");
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const res = await fetch(`${API_BASE}/api/sync/regions`);
  if (!res.ok) throw new Error(`지역 목록을 받지 못했어요 (${res.status})`);
  const data = (await res.json()) as { regions: Region[]; persistent: boolean };
  if (!data.persistent) log("⚠️ 서버에 KV 저장소가 연결되지 않아 앱에서 고른 지역 목록이 저장되지 않습니다.");
  if (!data.regions.length) {
    log("수집할 지역이 없습니다. 앱 설정에서 지역을 고르세요.");
    return;
  }
  for (const r of data.regions) {
    try {
      await crawlRegion(r);
    } catch (e) {
      log(`${r.name} 실패:`, e instanceof Error ? e.message : e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
