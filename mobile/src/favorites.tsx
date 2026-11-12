import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ScoredPlace } from "./types";

const KEY = "favorites:v1";

export type Favorite = ScoredPlace & { savedAt: number };

interface FavoritesValue {
  favorites: Favorite[];
  isFavorite: (id: string) => boolean;
  toggle: (place: ScoredPlace) => void;
  loaded: boolean;
}

const Ctx = createContext<FavoritesValue | null>(null);

/** 즐겨찾기: 기기 안(AsyncStorage)에 식당 정보를 통째로 저장해서 서버 없이도 지도에 다시 띄울 수 있게 한다 */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v) setFavorites(JSON.parse(v));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const toggle = useCallback((place: ScoredPlace) => {
    setFavorites((prev) => {
      const next = prev.some((f) => f.id === place.id)
        ? prev.filter((f) => f.id !== place.id)
        : [{ ...place, savedAt: Date.now() }, ...prev];
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<FavoritesValue>(
    () => ({ favorites, loaded, toggle, isFavorite: (id) => favorites.some((f) => f.id === id) }),
    [favorites, loaded, toggle],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFavorites() {
  const v = useContext(Ctx);
  if (!v) throw new Error("FavoritesProvider가 필요합니다");
  return v;
}
