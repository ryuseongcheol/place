import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { syncRegionsToServer, type RegionHit } from "./api";
import {
  MAX_REGIONS,
  REGION_RADIUS,
  deleteRegionFile,
  forgetRegion,
  getDataVersion,
  getProgress,
  loadPlaces,
  loadRegions,
  markForRecrawl,
  resetProgress,
  restoreProgress,
  runCrawls,
  saveRegions,
  subscribe,
  type RegionProgress,
} from "./crawlEngine";
import type { CrawledPlace, Region } from "./types";

export { MAX_REGIONS, REGION_RADIUS, type RegionProgress };

/**
 * 설정에서 고른 지역(최대 5곳) 관리. 실제 수집은 crawlEngine이 하고,
 * 앱이 꺼져 있을 때는 백그라운드 작업(backgroundCrawl.ts)이 같은 엔진으로 이어서 한다.
 * 지역 목록은 서버에도 보내서 매일 밤 서버 수집(GitHub Actions) 대상이 된다.
 */

interface RegionsValue {
  regions: Region[];
  progress: Record<string, RegionProgress>;
  /** 추가. 5곳을 넘으면 가장 먼저 고른 지역을 빼고 그 지역을 돌려준다 */
  addRegion: (hit: RegionHit) => Region | null;
  removeRegion: (id: string) => void;
  recrawl: (id: string) => void;
  loadPlaces: (id: string) => Promise<CrawledPlace[]>;
  dataVersion: number;
}

const Ctx = createContext<RegionsValue | null>(null);

export function RegionsProvider({ children }: { children: ReactNode }) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState<Record<string, RegionProgress>>({});
  const [dataVersion, setDataVersion] = useState(0);
  const regionsRef = useRef<Region[]>([]);
  regionsRef.current = regions;

  // 엔진 진행 상태 구독
  useEffect(() => {
    const unsub = subscribe(() => {
      setProgress(getProgress());
      setDataVersion(getDataVersion());
    });
    return () => {
      unsub();
    };
  }, []);

  const kick = useCallback(() => {
    runCrawls({ getRegions: () => regionsRef.current }).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const list = await loadRegions();
      await restoreProgress(list);
      regionsRef.current = list;
      setRegions(list);
      setLoaded(true);
      if (list.length) syncRegionsToServer(list).catch(() => {});
    })();
  }, []);

  useEffect(() => {
    if (loaded) kick();
  }, [loaded, regions, kick]);

  // 앱으로 돌아오면 이어서 (백그라운드 작업이 멈춘 곳부터)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && loaded) kick();
    });
    return () => sub.remove();
  }, [loaded, kick]);

  const commit = (next: Region[]) => {
    regionsRef.current = next;
    setRegions(next);
    saveRegions(next);
    syncRegionsToServer(next).catch(() => {});
  };

  const addRegion = useCallback((hit: RegionHit): Region | null => {
    if (regionsRef.current.some((r) => r.id === hit.id)) return null;
    const next = [...regionsRef.current, { ...hit, radius: REGION_RADIUS }];
    let removed: Region | null = null;
    if (next.length > MAX_REGIONS) {
      removed = next.shift()!;
      deleteRegionFile(removed.id);
      forgetRegion(removed.id);
    }
    resetProgress(hit.id);
    commit(next);
    return removed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeRegion = useCallback((id: string) => {
    commit(regionsRef.current.filter((r) => r.id !== id));
    deleteRegionFile(id);
    forgetRegion(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recrawl = useCallback(
    (id: string) => {
      deleteRegionFile(id).then(() => {
        markForRecrawl(id);
        resetProgress(id);
        kick();
      });
    },
    [kick],
  );

  const value = useMemo<RegionsValue>(
    () => ({ regions, progress, addRegion, removeRegion, recrawl, loadPlaces, dataVersion }),
    [regions, progress, addRegion, removeRegion, recrawl, dataVersion],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRegions() {
  const v = useContext(Ctx);
  if (!v) throw new Error("RegionsProvider가 필요합니다");
  return v;
}
