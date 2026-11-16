import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { THEME_PRESETS, combineThemes, type ThemePreset } from "./shared";
import type { ThemeDef } from "./types";

/**
 * 내 추천 주제 목록 (기기에 저장). 기본 주제(lib/themes.ts)를 바탕으로
 * 순서 바꾸기·숨기기·내용 고치기·새 주제 만들기가 된다.
 * 기본 주제를 고치지 않았으면 앱 업데이트로 바뀐 기본값을 그대로 따른다.
 */
export interface UserTheme extends ThemePreset {
  /** 기본 주제 (삭제 대신 숨기기·되돌리기) */
  builtin?: boolean;
  /** 기본 주제를 고쳤는지 */
  edited?: boolean;
  hidden?: boolean;
}

type StoredItem = { id: string; builtin: true; hidden?: boolean } | UserTheme;
const KEY = "themes:v1";

function merge(stored: StoredItem[] | null): UserTheme[] {
  const out: UserTheme[] = [];
  for (const s of stored ?? []) {
    if (s.builtin) {
      const base = THEME_PRESETS.find((p) => p.id === s.id);
      if (!base) continue;
      out.push("edited" in s && s.edited ? { ...(s as UserTheme), builtin: true } : { ...base, builtin: true, hidden: s.hidden });
    } else out.push(s as UserTheme);
  }
  // 새 버전에서 생긴 기본 주제는 뒤에 붙인다
  for (const p of THEME_PRESETS) if (!out.some((t) => t.id === p.id)) out.push({ ...p, builtin: true });
  return out;
}

const toStored = (list: UserTheme[]): StoredItem[] => list.map((t) => (t.builtin && !t.edited ? { id: t.id, builtin: true as const, hidden: t.hidden } : t));

/** 서버로 보낼 주제 내용 */
export function themeDef(t: ThemePreset): ThemeDef {
  return { id: t.id, ids: t.ids, label: t.label, emoji: t.emoji, description: t.description, keywords: t.keywords, includeCafe: t.includeCafe, avoid: t.avoid, attrs: t.attrs, weights: t.weights };
}

interface ThemesValue {
  themes: UserTheme[];
  /** 칩으로 보여줄 주제 (숨기지 않은 것, 순서대로) */
  visible: UserTheme[];
  get: (id: string) => UserTheme | undefined;
  save: (t: UserTheme) => void;
  remove: (id: string) => void;
  resetOne: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
  setHidden: (id: string, hidden: boolean) => void;
  resetAll: () => void;
  /** 고른 주제들을 하나로 (순서는 내 목록 순서) */
  combine: (ids: string[]) => ThemePreset | undefined;
}

const Ctx = createContext<ThemesValue | null>(null);

export function ThemesProvider({ children }: { children: ReactNode }) {
  const [themes, setThemes] = useState<UserTheme[]>(() => merge(null));

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => v && setThemes(merge(JSON.parse(v))))
      .catch(() => {});
  }, []);

  const update = useCallback((fn: (list: UserTheme[]) => UserTheme[]) => {
    setThemes((prev) => {
      const next = fn(prev);
      AsyncStorage.setItem(KEY, JSON.stringify(toStored(next))).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<ThemesValue>(() => {
    const get = (id: string) => themes.find((t) => t.id === id);
    return {
      themes,
      visible: themes.filter((t) => !t.hidden),
      get,
      save: (t) =>
        update((list) => {
          const i = list.findIndex((x) => x.id === t.id);
          if (i < 0) return [...list, { ...t, builtin: false, edited: false }];
          const cur = list[i];
          const next = [...list];
          next[i] = { ...t, builtin: cur.builtin, edited: !!cur.builtin, hidden: cur.hidden };
          return next;
        }),
      remove: (id) => update((list) => list.filter((t) => t.id !== id || t.builtin)),
      resetOne: (id) =>
        update((list) =>
          list.map((t) => {
            const base = THEME_PRESETS.find((p) => p.id === id);
            return t.id === id && base ? { ...base, builtin: true, hidden: t.hidden } : t;
          }),
        ),
      move: (id, dir) =>
        update((list) => {
          const i = list.findIndex((t) => t.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= list.length) return list;
          const next = [...list];
          [next[i], next[j]] = [next[j], next[i]];
          return next;
        }),
      setHidden: (id, hidden) => update((list) => list.map((t) => (t.id === id ? { ...t, hidden } : t))),
      resetAll: () => update(() => merge(null)),
      combine: (ids) => {
        const picked = themes
          .filter((t) => ids.includes(t.id))
          // 고치지 않은 기본 주제만 서버 DB의 미리 계산한 적합도를 쓸 수 있다
          .map((t) => ({ ...t, ids: t.builtin && !t.edited ? [t.id] : undefined }));
        return combineThemes(picked);
      },
    };
  }, [themes, update]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThemes() {
  const v = useContext(Ctx);
  if (!v) throw new Error("ThemesProvider가 필요합니다");
  return v;
}
