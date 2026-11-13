import type { Attrs } from "./classify";
import type { CrawledPlace } from "./types";
import { postMentionsPlace } from "./placeName";

/**
 * 유명 맛집 방송·유튜브·가이드 출연 여부.
 * 근거: 카카오맵 상세(방송 정보·후기·태그), 네이버 키워드 리뷰, 블로그 글(가게 이름과 프로그램 이름이 같은 글에 있을 때).
 * 목록을 늘리려면 여기에 추가하면 된다 (앱과 서버가 같이 쓴다).
 */
export interface Show {
  id: string;
  label: string;
  /** 본문에서 찾을 표기들 (공백 무시하고 비교) */
  aliases: string[];
  kind: "tv" | "youtube" | "guide";
}

export const SHOWS: Show[] = [
  { id: "wednesday", label: "수요미식회", aliases: ["수요미식회"], kind: "tv" },
  { id: "blackwhite", label: "흑백요리사", aliases: ["흑백요리사"], kind: "tv" },
  { id: "meokeultende", label: "성시경의 먹을텐데", aliases: ["먹을텐데"], kind: "youtube" },
  { id: "master", label: "생활의 달인", aliases: ["생활의달인"], kind: "tv" },
  { id: "top3", label: "백종원의 3대천왕", aliases: ["3대천왕"], kind: "tv" },
  { id: "tasty", label: "맛있는 녀석들", aliases: ["맛있는녀석들", "맛녀석"], kind: "tv" },
  { id: "baekban", label: "허영만의 백반기행", aliases: ["백반기행"], kind: "tv" },
  { id: "lineup", label: "줄 서는 식당", aliases: ["줄서는식당"], kind: "tv" },
  { id: "tobap", label: "토요일은 밥이 좋아", aliases: ["토요일은밥이좋아", "토밥"], kind: "tv" },
  { id: "ttogan", label: "풍자 또간집", aliases: ["또간집"], kind: "youtube" },
  { id: "michelin", label: "미쉐린 가이드", aliases: ["미쉐린", "미슐랭", "빕구르망"], kind: "guide" },
  { id: "blueribbon", label: "블루리본", aliases: ["블루리본"], kind: "guide" },
];

const byId = new Map(SHOWS.map((s) => [s.id, s]));
export const showLabel = (id: string) => byId.get(id)?.label ?? id;
export const showKind = (id: string) => byId.get(id)?.kind ?? "tv";

const squash = (s: string) => s.replace(/\s+/g, "");

/** 가게 자체 정보(카카오 상세 원본, 후기, 태그 등)에서 찾기 */
export function detectShows(texts: Array<string | null | undefined>): string[] {
  const t = squash(texts.filter(Boolean).join(" "));
  return SHOWS.filter((s) => s.aliases.some((a) => t.includes(squash(a)))).map((s) => s.id);
}

/** 블로그 글에서 찾기: 같은 글에 이 가게(지점) 이름과 프로그램 이름이 함께 있어야 인정 */
export function detectShowsInPosts(posts: Array<{ title: string; snippet: string }>, placeName: string, dong?: string | null): string[] {
  const found = new Set<string>();
  for (const p of posts) {
    const text = `${p.title} ${p.snippet}`;
    if (!postMentionsPlace(text, placeName, dong)) continue;
    for (const id of detectShows([text])) found.add(id);
  }
  return [...found];
}

export function mergeShows(...lists: Array<string[] | null | undefined>): string[] {
  return [...new Set(lists.flatMap((l) => l ?? []))];
}

/** 출연 확인 결과를 식당에 반영 (분류값 tvShow/guide 포함) */
export function applyShows(p: CrawledPlace, shows: string[]): CrawledPlace {
  const all = mergeShows(p.shows, shows);
  const tv = all.some((s) => showKind(s) !== "guide");
  const guide = all.some((s) => showKind(s) === "guide");
  const patch = (a: Attrs | undefined): Attrs => ({ ...(a ?? {}), ...(tv ? { tvShow: 1 } : {}), ...(guide ? { guide: 1 } : {}) });
  return { ...p, shows: all, showsCheckedAt: Date.now(), attrs: patch(p.attrs as Attrs), ruleAttrs: patch((p.ruleAttrs ?? p.attrs) as Attrs) };
}
