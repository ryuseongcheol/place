import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { snapOf, type PlaceSnap } from "./placeSnap";
import type { BasePlace } from "./types";

/**
 * 내 별점·메모·사진 (식당별). 기기 안(AsyncStorage)에 저장되고 앱을 업데이트해도 남는다.
 * 추천순에서 내가 2점 이하로 준 곳은 아래로 내린다. 내 타임라인에도 나온다.
 */
export interface MyNote {
  rating: number | null; // 1~5
  memo: string;
  /** 내 사진 (앱 저장 공간 파일 주소, src/myPhotos.ts) */
  photos?: string[];
  name: string;
  /** 타임라인에서 상세를 다시 열기 위한 식당 정보 (1.4.0부터) */
  place?: PlaceSnap;
  /** 처음 남긴 시각 (1.4.0부터, 그 전 기록은 updatedAt 사용) */
  createdAt?: number;
  updatedAt: number;
}

const KEY = "mynotes:v1";

type NotePlace = Pick<BasePlace, "id" | "name" | "category" | "address" | "roadAddress" | "phone" | "lat" | "lng" | "kakaoUrl">;

interface NotesValue {
  notes: Record<string, MyNote>;
  get: (id: string) => MyNote | null;
  save: (place: NotePlace, patch: Partial<Pick<MyNote, "rating" | "memo" | "photos">>) => void;
  /** 예전 기록에 식당 정보가 없으면 채운다 */
  attachPlace: (place: NotePlace) => void;
}

const Ctx = createContext<NotesValue | null>(null);

export function MyNotesProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Record<string, MyNote>>({});

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => v && setNotes(JSON.parse(v)))
      .catch(() => {});
  }, []);

  const save = useCallback((place: NotePlace, patch: Partial<Pick<MyNote, "rating" | "memo" | "photos">>) => {
    setNotes((prev) => {
      const now = Date.now();
      const cur = prev[place.id] ?? { rating: null, memo: "", name: place.name, createdAt: now, updatedAt: 0 };
      const merged: MyNote = { ...cur, ...patch, name: place.name, place: snapOf(place), updatedAt: now };
      const next = { ...prev };
      if (merged.rating === null && !merged.memo.trim() && !merged.photos?.length) delete next[place.id];
      else next[place.id] = merged;
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const attachPlace = useCallback((place: NotePlace) => {
    setNotes((prev) => {
      const cur = prev[place.id];
      if (!cur || cur.place) return prev;
      const next = { ...prev, [place.id]: { ...cur, place: snapOf(place) } };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<NotesValue>(() => ({ notes, get: (id) => notes[id] ?? null, save, attachPlace }), [notes, save, attachPlace]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMyNotes() {
  const v = useContext(Ctx);
  if (!v) throw new Error("MyNotesProvider가 필요합니다");
  return v;
}
