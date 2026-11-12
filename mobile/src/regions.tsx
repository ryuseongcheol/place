import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { crawlAi, crawlDetail, crawlList, type RegionHit } from "./api";
import { deviceKakaoBlocked, fetchKakaoRawDevice } from "./kakaoDevice";
import { lookupNaverPlace, naverDeviceBlocked, type NaverPlaceInfo } from "./naverDevice";
import { classify, detailFromRaw, haversine, mergeAttrs, type Attrs } from "./shared";
import type { AiClassifyInput, BasePlace, CrawlCursor, CrawlDetailItem, CrawledPlace, Region } from "./types";

/**
 * 설정에서 고른 지역(최대 5곳)의 맛집을 미리 수집해 기기에 저장한다.
 * 1) 목록: 서버가 카카오 공식 카테고리 검색으로 지역 안 식당을 모두 찾아줌 (커서로 이어받기)
 * 2) 상세: 폰에서 카카오맵 상세를 직접 받아 숨은 분류값 계산 (막히면 서버로)
 * 앱이 켜져 있는 동안 백그라운드로 진행하고, 앱을 다시 켜면 이어서 한다.
 */

export const MAX_REGIONS = 5;
export const REGION_RADIUS = 1000; // m
const MAX_DETAIL = 1200; // 지역당 상세 조회 상한 (중심에서 가까운 순)
const DETAIL_CONCURRENCY = 6;
const AI_BATCH = 20;
const SETTINGS_KEY = "regions:v1";
const FILE_VERSION = 1;

interface RegionFile {
  version: number;
  region: Region;
  places: Record<string, CrawledPlace>;
  listCursor: CrawlCursor | null;
  listStarted: boolean;
  listDone: boolean;
  doneAt: number | null;
}

export interface RegionProgress {
  phase: "waiting" | "listing" | "detail" | "ai" | "done" | "error";
  listed: number;
  detailed: number;
  target: number;
  /** AI 분류를 마친 곳 수 (AI 키가 없으면 0) */
  aiDone?: number;
  message?: string;
  doneAt?: number | null;
}

// ---------- 저장소 (앱: 파일, 웹 미리보기: AsyncStorage) ----------

const safe = (id: string) => id.replace(/[^\w-]/g, "_");
const dir = Platform.OS === "web" ? null : new Directory(Paths.document, "regions");

async function readRegionFile(id: string): Promise<RegionFile | null> {
  try {
    if (!dir) {
      const v = await AsyncStorage.getItem(`regionfile:${safe(id)}`);
      return v ? JSON.parse(v) : null;
    }
    const f = new File(dir, `${safe(id)}.json`);
    if (!f.exists) return null;
    const data = JSON.parse(await f.text()) as RegionFile;
    return data.version === FILE_VERSION ? data : null;
  } catch {
    return null;
  }
}

async function writeRegionFile(data: RegionFile) {
  const json = JSON.stringify(data);
  if (!dir) {
    await AsyncStorage.setItem(`regionfile:${safe(data.region.id)}`, json);
    return;
  }
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const f = new File(dir, `${safe(data.region.id)}.json`);
  if (!f.exists) f.create({ intermediates: true });
  await f.write(json);
}

async function deleteRegionFile(id: string) {
  try {
    if (!dir) return AsyncStorage.removeItem(`regionfile:${safe(id)}`);
    const f = new File(dir, `${safe(id)}.json`);
    if (f.exists) f.delete();
  } catch {
    // 무시
  }
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
    priceLevel: null,
    detailAt: null,
  };
}

function applyDetail(p: CrawledPlace, d: CrawlDetailItem, naver: NaverPlaceInfo | null): CrawledPlace {
  return {
    ...p,
    naverId: naver?.id ?? null,
    naverVisitorReviewCount: naver?.visitorReviewCount ?? 0,
    naverBlogReviewCount: naver?.blogReviewCount ?? 0,
    naverKeywords: naver?.keywords ?? [],
    ruleAttrs: d.attrs,
    aiAt: null,
    rating: d.rating,
    ratingCount: d.ratingCount,
    reviewCount: d.reviewCount,
    blogReviewCount: d.blogReviewCount,
    menus: d.menus,
    tags: d.tags,
    snippets: d.snippets,
    openHours: d.openHours,
    attrs: d.attrs,
    priceLevel: d.priceLevel,
    detailAt: Date.now(),
    detailFailed: !d.ok,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// ---------- Context ----------

interface RegionsValue {
  regions: Region[];
  progress: Record<string, RegionProgress>;
  /** 추가. 5곳을 넘으면 가장 먼저 고른 지역을 빼고 그 지역을 돌려준다 */
  addRegion: (hit: RegionHit) => Region | null;
  removeRegion: (id: string) => void;
  recrawl: (id: string) => void;
  loadPlaces: (id: string) => Promise<CrawledPlace[]>;
  /** 수집 데이터가 바뀔 때마다 증가 (화면 갱신용) */
  dataVersion: number;
}

const Ctx = createContext<RegionsValue | null>(null);

export function RegionsProvider({ children }: { children: ReactNode }) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState<Record<string, RegionProgress>>({});
  const [dataVersion, setDataVersion] = useState(0);
  const regionsRef = useRef<Region[]>([]);
  const running = useRef(false);
  const errored = useRef(new Set<string>());
  const cache = useRef(new Map<string, CrawledPlace[]>());
  const aiUnavailable = useRef(false);
  regionsRef.current = regions;

  const setP = useCallback((id: string, p: Partial<RegionProgress>) => {
    setProgress((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { phase: "waiting", listed: 0, detailed: 0, target: 0 }), ...p } }));
  }, []);

  // 저장된 지역 불러오기 + 진행 상태 복원
  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem(SETTINGS_KEY);
        const list: Region[] = v ? JSON.parse(v) : [];
        for (const r of list) {
          const f = await readRegionFile(r.id);
          const places = f ? Object.values(f.places) : [];
          setP(r.id, {
            phase: f?.doneAt ? "done" : "waiting",
            listed: places.length,
            detailed: places.filter((p) => p.detailAt).length,
            target: Math.min(MAX_DETAIL, places.length),
            doneAt: f?.doneAt ?? null,
          });
        }
        setRegions(list);
      } finally {
        setLoaded(true);
      }
    })();
  }, [setP]);

  const persist = (list: Region[]) => AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(list)).catch(() => {});
  const stillSelected = (id: string) => regionsRef.current.some((r) => r.id === id);

  const save = async (data: RegionFile) => {
    await writeRegionFile(data);
    cache.current.set(data.region.id, Object.values(data.places));
    setDataVersion((v) => v + 1);
  };

  const crawlRegion = async (region: Region) => {
    const data: RegionFile = (await readRegionFile(region.id)) ?? {
      version: FILE_VERSION,
      region,
      places: {},
      listCursor: null,
      listStarted: false,
      listDone: false,
      doneAt: null,
    };
    // 이미 끝난 지역도 다시 훑는다: 한도가 늘었으면 남은 곳 상세, AI 키가 생겼으면 AI 분류

    // 1) 목록
    while (!data.listDone) {
      if (!stillSelected(region.id)) return;
      setP(region.id, { phase: "listing", listed: Object.keys(data.places).length });
      const res = await crawlList(region, data.listStarted ? data.listCursor : null);
      data.listStarted = true;
      for (const p of res.places) if (!data.places[p.id]) data.places[p.id] = fromBase(p, region);
      data.listCursor = res.cursor;
      data.listDone = res.cursor === null;
      await save(data);
    }

    // 2) 상세 (중심에서 가까운 순으로 최대 MAX_DETAIL곳)
    const all = Object.values(data.places).sort((a, b) => a.distance - b.distance);
    const targets = all.slice(0, MAX_DETAIL);
    const pending = targets.filter((p) => !p.detailAt);
    let detailed = targets.length - pending.length;
    setP(region.id, { phase: "detail", listed: all.length, detailed, target: targets.length });

    let sinceSave = 0;
    const done = async (p: CrawledPlace, d: CrawlDetailItem, naver: NaverPlaceInfo | null = null) => {
      data.places[p.id] = applyDetail(p, d, naver);
      detailed++;
      sinceSave++;
      if (sinceSave >= 20) {
        sinceSave = 0;
        await save(data);
      }
      setP(region.id, { detailed });
    };

    let i = 0;
    while (i < pending.length) {
      if (!stillSelected(region.id)) return;
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
    await save(data);

    // 3) AI 분류 (서버에 ANTHROPIC_API_KEY가 있을 때만). 상세를 받은 곳만, 규칙 분류와 섞는다
    if (!aiUnavailable.current) {
      const aiTargets = Object.values(data.places).filter((p) => p.detailAt && !p.aiAt && !p.id.startsWith("mock-"));
      let aiDone = Object.values(data.places).filter((p) => p.aiAt).length;
      setP(region.id, { phase: "ai", aiDone });
      for (let j = 0; j < aiTargets.length; j += AI_BATCH) {
        if (!stillSelected(region.id)) return;
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
          await save(data);
        } catch (e) {
          // 키가 없으면(503) 이번 실행 동안은 AI 단계를 건너뛴다. 그 밖의 오류는 다음 묶음으로
          if (e instanceof Error && /ANTHROPIC_API_KEY/.test(e.message)) {
            aiUnavailable.current = true;
            break;
          }
        }
      }
    }

    data.doneAt = Date.now();
    await save(data);
    setP(region.id, { phase: "done", detailed, doneAt: data.doneAt });
  };

  // 수집 대기열 처리 (한 번에 한 지역씩)
  const kick = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = regionsRef.current.find((r) => !errored.current.has(r.id) && !cache.current.get(`done:${r.id}`));
        if (!next) break;
        try {
          await crawlRegion(next);
          cache.current.set(`done:${next.id}`, []);
        } catch (e) {
          errored.current.add(next.id);
          setP(next.id, { phase: "error", message: e instanceof Error ? e.message : "수집 실패" });
        }
      }
    } finally {
      running.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loaded) kick();
  }, [loaded, regions, kick]);

  const addRegion = useCallback(
    (hit: RegionHit): Region | null => {
      if (regionsRef.current.some((r) => r.id === hit.id)) return null;
      const next = [...regionsRef.current, { ...hit, radius: REGION_RADIUS }];
      let removed: Region | null = null;
      if (next.length > MAX_REGIONS) {
        removed = next.shift()!;
        deleteRegionFile(removed.id);
        cache.current.delete(removed.id);
        cache.current.delete(`done:${removed.id}`);
      }
      regionsRef.current = next;
      setRegions(next);
      persist(next);
      setP(hit.id, { phase: "waiting", listed: 0, detailed: 0, target: 0 });
      return removed;
    },
    [setP],
  );

  const removeRegion = useCallback((id: string) => {
    const next = regionsRef.current.filter((r) => r.id !== id);
    regionsRef.current = next;
    setRegions(next);
    persist(next);
    deleteRegionFile(id);
    cache.current.delete(id);
    cache.current.delete(`done:${id}`);
    errored.current.delete(id);
    setProgress((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const recrawl = useCallback(
    (id: string) => {
      deleteRegionFile(id).then(() => {
        cache.current.delete(id);
        cache.current.delete(`done:${id}`);
        errored.current.delete(id);
        setP(id, { phase: "waiting", listed: 0, detailed: 0, target: 0, message: undefined, doneAt: null });
        kick();
      });
    },
    [kick, setP],
  );

  const loadPlaces = useCallback(async (id: string) => {
    const hit = cache.current.get(id);
    if (hit) return hit;
    const f = await readRegionFile(id);
    const list = f ? Object.values(f.places) : [];
    cache.current.set(id, list);
    return list;
  }, []);

  const value = useMemo<RegionsValue>(
    () => ({ regions, progress, addRegion, removeRegion, recrawl, loadPlaces, dataVersion }),
    [regions, progress, addRegion, removeRegion, recrawl, loadPlaces, dataVersion],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRegions() {
  const v = useContext(Ctx);
  if (!v) throw new Error("RegionsProvider가 필요합니다");
  return v;
}
