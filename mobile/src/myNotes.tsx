import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * 내 별점·메모 (식당별). 기기 안(AsyncStorage)에 저장되고 앱을 업데이트해도 남는다.
 * 추천순에서 내가 2점 이하로 준 곳은 아래로 내린다.
 */
export interface MyNote {
  rating: number | null; // 1~5
  memo: string;
  /** 내 사진 (앱 저장 공간 파일 주소, src/myPhotos.ts) */
  photos?: string[];
  name: string;
  updatedAt: number;
}

const KEY = "mynotes:v1";

interface NotesValue {
  notes: Record<string, MyNote>;
  get: (id: string) => MyNote | null;
  save: (id: string, name: string, patch: Partial<Pick<MyNote, "rating" | "memo" | "photos">>) => void;
}

const Ctx = createContext<NotesValue | null>(null);

export function MyNotesProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Record<string, MyNote>>({});

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => v && setNotes(JSON.parse(v)))
      .catch(() => {});
  }, []);

  const save = useCallback((id: string, name: string, patch: Partial<Pick<MyNote, "rating" | "memo" | "photos">>) => {
    setNotes((prev) => {
      const cur = prev[id] ?? { rating: null, memo: "", name, updatedAt: 0 };
      const merged: MyNote = { ...cur, ...patch, name, updatedAt: Date.now() };
      const next = { ...prev };
      if (merged.rating === null && !merged.memo.trim() && !merged.photos?.length) delete next[id];
      else next[id] = merged;
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<NotesValue>(() => ({ notes, get: (id) => notes[id] ?? null, save }), [notes, save]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMyNotes() {
  const v = useContext(Ctx);
  if (!v) throw new Error("MyNotesProvider가 필요합니다");
  return v;
}
