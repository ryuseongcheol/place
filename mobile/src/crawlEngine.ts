import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { crawlAi, crawlDetail, crawlList, crawlShows, uploadPlaces } from "./api";
import { deviceKakaoBlocked, fetchKakaoRawDevice } from "./kakaoDevice";
import { lookupNaverPlace, naverDeviceBlocked, type NaverPlaceInfo } from "./naverDevice";
import { applyShows, classify, detailFromRaw, haversine, mergeAttrs, mergeShows, type Attrs } from "./shared";
import type { AiClassifyInput, BasePlace, CrawlDetailItem, CrawledPlace, Region, RegionFile } from "./types";

/**
 * 지역 맛집 수집 엔진. 화면(React)과 분리돼 있어서
 * - 앱이 켜져 있을 때: RegionsProvider가 실행
 * - 앱이 꺼져 있을 때: 안드로이드 백그라운드 작업(src/backgroundCrawl.ts)이 실행
 * 둘이 같은 JS 런타임에서 겹치지 않게 잠금(running)을 둔다. 진행 중 저장은 파일에 바로 하므로 언제 끊겨도 이어서 할 수 있다.
 *
 * 단계: 서버 야간 수집 결과 받아 합치기 → 목록 → 상세(카카오+네이버, 폰에서) → AI 분류(서버)
 */

export const MAX_REGIONS = 5;
export const REGION_RADIUS = 1000; // m
const MAX_DETAIL = 1200; // 지역당 상세 조회 상한 (중심에서 가까운 순)
const DETAIL_CONCURRENCY = 6;
const AI_BATCH = 20;
const SETTINGS_KEY = "regions:v1";
export const FILE_VERSION = 1;
/** 서버 야간 수집 결과 위치 (GitHub Release) */
const REMOTE_BASE = (process.env.EXPO_PUBLIC_REGION_DATA_URL || "https://github.com/ryuseongcheol/place/releases/download/region-data").replace(/\/$/, "");
const REMOTE_CHECK_INTERVAL = 3 * 60 * 60 * 1000;

export interface RegionProgress {
  phase: "waiting" | "listing" | "detail" | "shows" | "ai" | "done" | "error";
  listed: number;
  detailed: number;
  target: number;
  aiDone?: number;
  message?: string;
  doneAt?: number | null;
}

// ---------- 이벤트 ----------

type Listener = () => void;
const listeners = new Set<Listener>();
const progress: Record<string, RegionProgress> = {};
let dataVersion = 0;

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn());
export const getProgress = () => ({ ...progress });
export const getDataVersion = () => dataVersion;

function setP(id: string, p: Partial<RegionProgress>) {
  progress[id] = { ...(progress[id] ?? { phase: "waiting", listed: 0, detailed: 0, target: 0 }), ...p };
  emit();
}

// ---------- 저장소 (앱: 파일, 웹 미리보기: AsyncStorage) ----------

export const safeId = (id: string) => id.replace(/[^\w-]/g, "_");
const dir = Platform.OS === "web" ? null : new Directory(Paths.document, "regions");

export async function readRegionFile(id: string): Promise<RegionFile | null> {
  try {
    if (!dir) {
      const v = await AsyncStorage.getItem(`regionfile:${safeId(id)}`);
      return v ? JSON.parse(v) : null;
    }
    const f = new File(dir, `${safeId(id)}.json`);
    if (!f.exists) return null;
    const data = JSON.parse(await f.text()) as RegionFile;
    return data.version === FILE_VERSION ? data : null;
  } catch {
    return null;
  }
}

const cache = new Map<string, CrawledPlace[]>();

// ---------- 서버 DB 올리기 ----------

let dbUnavailable = false;
let uploading = false;

/** 상세·AI가 바뀐 식당을 서버 DB에 올린다 (실패해도 수집에는 영향 없음, 다음 저장 때 다시) */
async function uploadChanged(data: RegionFile) {
  if (dbUnavailable || uploading) return;
  const changed = Object.values(data.places).filter(
    (p) => /^\d+$/.test(p.id) && p.detailAt && Math.max(p.detailAt ?? 0, p.aiAt ?? 0, p.showsCheckedAt ?? 0) > (p.dbAt ?? 0),
  );
  if (!changed.length) return;
  uploading = true;
  try {
    for (let i = 0; i < changed.length; i += 25) {
      const batch = changed.slice(i, i + 25);
      await uploadPlaces(batch.map(({ dbAt: _d, ...rest }) => rest));
      const now = Date.now();
      for (const p of batch) if (data.places[p.id]) data.places[p.id] = { ...data.places[p.id], dbAt: now };
    }
  } catch (e) {
    if (e instanceof Error && /DB가 연결되지/.test(e.message)) dbUnavailable = true;
  } finally {
    uploading = false;
  }
}

async function writeRegionFile(data: RegionFile, upload = true) {
  if (upload) await uploadChanged(data);
  const json = JSON.stringify(data);
  if (!dir) await AsyncStorage.setItem(`regionfile:${safeId(data.region.id)}`, json);
  else {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const f = new File(dir, `${safeId(data.region.id)}.json`);
    if (!f.exists) f.create({ intermediates: true });
    await f.write(json);
  }
  cache.set(data.region.id, Object.values(data.places));
  dataVersion++;
  emit();
}

export async function deleteRegionFile(id: string) {
  cache.delete(id);
  try {
    if (!dir) await AsyncStorage.removeItem(`regionfile:${safeId(id)}`);
    else {
      const f = new File(dir, `${safeId(id)}.json`);
      if (f.exists) f.delete();
    }
  } catch {
    // 무시
  }
}

export async function loadPlaces(id: string): Promise<CrawledPlace[]> {
  const hit = cache.get(id);
  if (hit) return hit;
  const f = await readRegionFile(id);
  const list = f ? Object.values(f.places) : [];
  cache.set(id, list);
  return list;
}

export async function loadRegions(): Promise<Region[]> {
  try {
    const v = await AsyncStorage.getItem(SETTINGS_KEY);
    return v ? JSON.parse(v) : [];
  } catch {
    return [];
  }
}

export async function saveRegions(list: Region[]) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(list)).catch(() => {});
}

/** 앱 시작 시 저장된 파일로 진행 상태 복원 */
export async function restoreProgress(regions: Region[]) {
  for (const r of regions) {
    const f = await readRegionFile(r.id);
    const places = f ? Object.values(f.places) : [];
    setP(r.id, {
      phase: f?.doneAt ? "done" : "waiting",
      listed: places.length,
      detailed: places.filter((p) => p.detailAt).length,
      target: Math.min(MAX_DETAIL, places.length),
      aiDone: places.filter((p) => p.aiAt).length,
      doneAt: f?.doneAt ?? null,
    });
  }
}

export function resetProgress(id: string) {
  delete progress[id];
  setP(id, { phase: "waiting", listed: 0, detailed: 0, target: 0, aiDone: 0, message: undefined, doneAt: null });
}

export function forgetRegion(id: string) {
  delete progress[id];
  errored.delete(id);
  emit();
}

// ---------- 변환 ----------

function fromBase(p: BasePlace, region: Region): CrawledPlace {
  // 목록 단계에서는 이름·카테고리만으로 1차 분류 (상세를 못 받아도 주제별 분류가 되도록)
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

function applyDetail(p: CrawledPlace, d: CrawlDetailItem, naver: NaverPlaceInfo | null): CrawledPlace {
  return {
    ...p,
    naverId: naver?.id ?? p.naverId ?? null,
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

/** 서버 결과와 기기 결과 합치기: 정보가 더 많은 쪽(AI 분류 > 상세 > 목록), 네이버 정보는 있는 쪽 */
function mergePlace(local: CrawledPlace | undefined, remote: CrawledPlace): CrawledPlace {
  if (!local) return remote;
  const rank = (p: CrawledPlace) => (p.aiAt ? 3 : 0) + (p.detailAt && !p.detailFailed ? 2 : p.detailAt ? 1 : 0);
  const base = rank(remote) > rank(local) || (rank(remote) === rank(local) && (remote.detailAt ?? 0) > (local.detailAt ?? 0)) ? remote : local;
  const other = base === remote ? local : remote;
  return {
    ...base,
    naverId: base.naverId ?? other.naverId ?? null,
    naverVisitorReviewCount: base.naverVisitorReviewCount || other.naverVisitorReviewCount || 0,
    naverBlogReviewCount: base.naverBlogReviewCount || other.naverBlogReviewCount || 0,
    naverKeywords: base.naverKeywords?.length ? base.naverKeywords : (other.naverKeywords ?? []),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- 수집 ----------

let running = false;
let aiUnavailable = false;
let showsUnavailable = false;
const errored = new Set<string>();
const finished = new Set<string>();

export function isRunning() {
  return running;
}

export function markForRecrawl(id: string) {
  errored.delete(id);
  finished.delete(id);
}

/** 서버(야간 수집) 결과가 더 새로우면 받아서 합친다 */
async function syncRemote(data: RegionFile): Promise<boolean> {
  if (data.remoteCheckedAt && Date.now() - data.remoteCheckedAt < REMOTE_CHECK_INTERVAL) return false;
  data.remoteCheckedAt = Date.now();
  try {
    const res = await fetch(`${REMOTE_BASE}/region-${safeId(data.region.id)}.json`);
    if (!res.ok) return false;
    const remote = (await res.json()) as RegionFile;
    if (!remote?.places || !remote.doneAt || remote.doneAt <= (data.remoteDoneAt ?? 0)) return false;
    for (const [id, rp] of Object.entries(remote.places)) data.places[id] = mergePlace(data.places[id], rp);
    if (remote.listDone) {
      data.listDone = true;
      data.listStarted = true;
      data.listCursor = null;
    }
    data.remoteDoneAt = remote.doneAt;
    return true;
  } catch {
    return false;
  }
}

async function crawlRegion(region: Region, outOfTime: () => boolean, stillSelected: (id: string) => boolean): Promise<"done" | "paused"> {
  const data: RegionFile = (await readRegionFile(region.id)) ?? {
    version: FILE_VERSION,
    region,
    places: {},
    listCursor: null,
    listStarted: false,
    listDone: false,
    doneAt: null,
  };

  // 0) 서버 야간 수집 결과
  if (await syncRemote(data)) await writeRegionFile(data);

  // 1) 목록
  while (!data.listDone) {
    if (!stillSelected(region.id) || outOfTime()) return "paused";
    setP(region.id, { phase: "listing", listed: Object.keys(data.places).length });
    const res = await crawlList(region, data.listStarted ? data.listCursor : null);
    data.listStarted = true;
    for (const p of res.places) if (!data.places[p.id]) data.places[p.id] = fromBase(p, region);
    data.listCursor = res.cursor;
    data.listDone = res.cursor === null;
    data.doneAt = null;
    await writeRegionFile(data);
  }

  // 2) 상세 (중심에서 가까운 순으로 최대 MAX_DETAIL곳)
  const all = Object.values(data.places).sort((a, b) => a.distance - b.distance);
  const targets = all.slice(0, MAX_DETAIL);
  const pending = targets.filter((p) => !p.detailAt);
  let detailed = targets.length - pending.length;
  if (pending.length) data.doneAt = null;
  setP(region.id, { phase: "detail", listed: all.length, detailed, target: targets.length });

  let sinceSave = 0;
  const done = async (p: CrawledPlace, d: CrawlDetailItem, naver: NaverPlaceInfo | null = null) => {
    data.places[p.id] = applyDetail(data.places[p.id] ?? p, d, naver);
    detailed++;
    sinceSave++;
    if (sinceSave >= 20) {
      sinceSave = 0;
      await writeRegionFile(data);
    }
    setP(region.id, { detailed });
  };

  let i = 0;
  while (i < pending.length) {
    if (!stillSelected(region.id) || outOfTime()) {
      await writeRegionFile(data);
      return "paused";
    }
    const useServer = pending[i].id.startsWith("mock-") || deviceKakaoBlocked();
    if (useServer) {
      const chunk = pending.slice(i, i + 12);
      const res = await crawlDetail(chunk.map((p) => ({ id: p.id, name: p.name, category: p.category })));
      for (const item of res.items) {
        const p = data.places[item.id];
        if (p) await done(p, item);
      }
      i += chunk.length;
    } else {
      // 폰에서 여러 곳을 동시에: 카카오 상세 + 네이버(리뷰 수·키워드 리뷰)
      const chunk = pending.slice(i, i + DETAIL_CONCURRENCY);
      await Promise.all(
        chunk.map(async (p) => {
          const [raw, naver] = await Promise.all([
            fetchKakaoRawDevice(p.id),
            naverDeviceBlocked() ? Promise.resolve(null) : lookupNaverPlace(p).catch(() => null),
          ]);
          const extra = naver ? { keywords: naver.keywords, visitorReviewCount: naver.visitorReviewCount, blogReviewCount: naver.blogReviewCount } : {};
          await done(p, detailFromRaw(p, raw, extra), naver);
        }),
      );
      i += chunk.length;
      await sleep(60);
    }
  }
  await writeRegionFile(data);

  // 3) 방송·가이드 출연 확인 (서버가 네이버 블로그 검색. 네이버 검색 키가 있을 때만)
  if (!showsUnavailable) {
    const showTargets = Object.values(data.places)
      .filter((p) => p.detailAt && !p.showsCheckedAt)
      .sort((a, b) => a.distance - b.distance);
    if (showTargets.length) {
      data.doneAt = null;
      setP(region.id, { phase: "shows" });
    }
    for (let j = 0; j < showTargets.length; j += 30) {
      if (!stillSelected(region.id) || outOfTime()) return "paused";
      try {
        const res = await crawlShows(region, showTargets.slice(j, j + 30));
        for (const it of res.items) if (data.places[it.id]) data.places[it.id] = applyShows(data.places[it.id], it.shows);
        await writeRegionFile(data);
      } catch (e) {
        if (e instanceof Error && /키가 없어/.test(e.message)) {
          showsUnavailable = true;
          break;
        }
      }
    }
  }

  // 4) AI 분류 (서버에 ANTHROPIC_API_KEY가 있을 때만). 상세를 받은 곳만, 규칙 분류와 섞는다
  if (!aiUnavailable) {
    const aiTargets = Object.values(data.places).filter((p) => p.detailAt && !p.aiAt && !p.id.startsWith("mock-"));
    let aiDone = Object.values(data.places).filter((p) => p.aiAt).length;
    if (aiTargets.length) {
      data.doneAt = null;
      setP(region.id, { phase: "ai", aiDone });
    }
    for (let j = 0; j < aiTargets.length; j += AI_BATCH) {
      if (!stillSelected(region.id) || outOfTime()) return "paused";
      const batch = aiTargets.slice(j, j + AI_BATCH);
      try {
        const res = await crawlAi(batch.map(aiInput));
        for (const it of res.items) {
          const p = data.places[it.id];
          if (!p) continue;
          data.places[it.id] = { ...p, attrs: mergeAttrs((p.ruleAttrs ?? p.attrs) as Attrs, it.attrs as Attrs), aiAt: Date.now() };
          aiDone++;
        }
        setP(region.id, { aiDone });
        await writeRegionFile(data);
      } catch (e) {
        // 키가 없으면 이번 실행 동안은 AI 단계를 건너뛴다. 그 밖의 오류는 다음 묶음으로
        if (e instanceof Error && /ANTHROPIC_API_KEY/.test(e.message)) {
          aiUnavailable = true;
          break;
        }
      }
    }
  }

  if (!data.doneAt) data.doneAt = Date.now();
  await writeRegionFile(data);
  setP(region.id, { phase: "done", detailed, doneAt: data.doneAt });
  return "done";
}

/**
 * 고른 지역들을 차례로 수집. 이미 실행 중이면 바로 돌아간다.
 * deadline(ms 시각)을 주면 그때까지만 하고 멈춘다 (백그라운드 작업용).
 */
export async function runCrawls(opts: { deadline?: number; getRegions?: () => Region[] } = {}): Promise<"idle" | "busy" | "paused"> {
  if (running) return "busy";
  running = true;
  const outOfTime = () => (opts.deadline ? Date.now() > opts.deadline : false);
  try {
    const regionsNow = async () => (opts.getRegions ? opts.getRegions() : await loadRegions());
    for (;;) {
      const regions = await regionsNow();
      const next = regions.find((r) => !errored.has(r.id) && !finished.has(r.id));
      if (!next) return "idle";
      if (outOfTime()) return "paused";
      try {
        const ids = new Set(regions.map((r) => r.id));
        const result = await crawlRegion(next, outOfTime, (id) => (opts.getRegions ? opts.getRegions().some((r) => r.id === id) : ids.has(id)));
        if (result === "paused") return "paused";
        finished.add(next.id);
      } catch (e) {
        errored.add(next.id);
        setP(next.id, { phase: "error", message: e instanceof Error ? e.message : "수집 실패" });
      }
    }
  } finally {
    running = false;
  }
}
