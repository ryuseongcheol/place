import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ScoredPlace } from "./types";

/**
 * 즐겨찾기 + 그룹(리스트). 네이버 지도 "저장" 리스트처럼 식당 하나를 여러 리스트에 넣을 수 있다.
 * 기기 안(AsyncStorage)에 식당 정보를 통째로 저장해서 서버 없이도 지도에 다시 띄운다.
 */

/** 네이버 지도 마커 기본 색과 맞춘 리스트 색 */
export const GROUP_COLORS = [
  { symbol: "red", hex: "#E5484D" },
  { symbol: "yellow", hex: "#F5A400" },
  { symbol: "green", hex: "#30A46C" },
  { symbol: "blue", hex: "#3E63DD" },
  { symbol: "lightblue", hex: "#0EA5E9" },
  { symbol: "pink", hex: "#E93D82" },
  { symbol: "gray", hex: "#8B8D98" },
  { symbol: "black", hex: "#1F1A14" },
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number]["symbol"];
export const colorHex = (c: GroupColor) => GROUP_COLORS.find((g) => g.symbol === c)?.hex ?? "#E5484D";

export interface FavGroup {
  id: string;
  name: string;
  color: GroupColor;
  createdAt: number;
}

export interface FavItem {
  place: ScoredPlace;
  groupIds: string[];
  savedAt: number;
}

interface Stored {
  groups: FavGroup[];
  items: Record<string, FavItem>;
}

const KEY = "favorites:v2";
const LEGACY_KEY = "favorites:v1";
export const DEFAULT_GROUP_ID = "default";
const DEFAULT_GROUP: FavGroup = { id: DEFAULT_GROUP_ID, name: "기본 리스트", color: "red", createdAt: 0 };

interface FavoritesValue {
  loaded: boolean;
  groups: FavGroup[];
  items: FavItem[];
  isFavorite: (id: string) => boolean;
  groupsOf: (id: string) => string[];
  /** 이 식당이 들어갈 리스트를 정한다. 빈 배열이면 즐겨찾기에서 뺀다 */
  setPlaceGroups: (place: ScoredPlace, groupIds: string[]) => void;
  createGroup: (name: string, color: GroupColor) => string;
  updateGroup: (id: string, patch: Partial<Pick<FavGroup, "name" | "color">>) => void;
  deleteGroup: (id: string) => void;
  placesIn: (groupId: string | null) => ScoredPlace[];
  colorOf: (placeId: string) => GroupColor | null;
}

const Ctx = createContext<FavoritesValue | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Stored>({ groups: [DEFAULT_GROUP], items: {} });
  const [loaded, setLoaded] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem(KEY);
        if (v) {
          const s = JSON.parse(v) as Stored;
          if (!s.groups.some((g) => g.id === DEFAULT_GROUP_ID)) s.groups.unshift(DEFAULT_GROUP);
          setState(s);
          return;
        }
        // 예전 버전(그룹 없음) 즐겨찾기 옮기기
        const legacy = await AsyncStorage.getItem(LEGACY_KEY);
        if (legacy) {
          const list = JSON.parse(legacy) as Array<ScoredPlace & { savedAt: number }>;
          const items: Record<string, FavItem> = {};
          for (const { savedAt, ...place } of list) items[place.id] = { place, groupIds: [DEFAULT_GROUP_ID], savedAt };
          const s = { groups: [DEFAULT_GROUP], items };
          setState(s);
          AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
        }
      } catch {
        // 무시
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const update = useCallback((fn: (s: Stored) => Stored) => {
    setState((prev) => {
      const next = fn(prev);
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const setPlaceGroups = useCallback(
    (place: ScoredPlace, groupIds: string[]) =>
      update((s) => {
        const items = { ...s.items };
        if (groupIds.length === 0) delete items[place.id];
        else items[place.id] = { place, groupIds, savedAt: s.items[place.id]?.savedAt ?? Date.now() };
        return { ...s, items };
      }),
    [update],
  );

  const createGroup = useCallback(
    (name: string, color: GroupColor) => {
      const id = `g${Date.now().toString(36)}`;
      update((s) => ({ ...s, groups: [...s.groups, { id, name: name.trim().slice(0, 20) || "새 리스트", color, createdAt: Date.now() }] }));
      return id;
    },
    [update],
  );

  const updateGroup = useCallback(
    (id: string, patch: Partial<Pick<FavGroup, "name" | "color">>) =>
      update((s) => ({ ...s, groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch, name: (patch.name ?? g.name).slice(0, 20) } : g)) })),
    [update],
  );

  const deleteGroup = useCallback(
    (id: string) => {
      if (id === DEFAULT_GROUP_ID) return;
      update((s) => {
        const items: Record<string, FavItem> = {};
        for (const [k, it] of Object.entries(s.items)) {
          const groupIds = it.groupIds.filter((g) => g !== id);
          if (groupIds.length) items[k] = { ...it, groupIds };
        }
        return { groups: s.groups.filter((g) => g.id !== id), items };
      });
    },
    [update],
  );

  const value = useMemo<FavoritesValue>(() => {
    const items = Object.values(state.items).sort((a, b) => b.savedAt - a.savedAt);
    const groupColor = new Map(state.groups.map((g) => [g.id, g.color]));
    return {
      loaded,
      groups: state.groups,
      items,
      isFavorite: (id) => Boolean(state.items[id]),
      groupsOf: (id) => state.items[id]?.groupIds ?? [],
      setPlaceGroups,
      createGroup,
      updateGroup,
      deleteGroup,
      placesIn: (groupId) => items.filter((it) => groupId === null || it.groupIds.includes(groupId)).map((it) => it.place),
      colorOf: (placeId) => {
        const g = state.items[placeId]?.groupIds[0];
        return g ? (groupColor.get(g) ?? "red") : null;
      },
    };
  }, [state, loaded, setPlaceGroups, createGroup, updateGroup, deleteGroup]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFavorites() {
  const v = useContext(Ctx);
  if (!v) throw new Error("FavoritesProvider가 필요합니다");
  return v;
}
