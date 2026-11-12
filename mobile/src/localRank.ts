import { ATTR_LABELS, THEME_PRESETS, attrFit, haversine, normalizeName, topReasons, type AttrKey, type Attrs, type ThemePreset } from "./shared";
import type { CrawledPlace, ScoredPlace } from "./types";

/**
 * 미리 수집한 지역 데이터로 순위를 낸다 (서버 호출 없음).
 * 주제: 숨은 분류값 적합도 50% + 별점 30% + 리뷰 수 20%
 * 검색어: 이름·카테고리·메뉴·태그·후기 일치 + 분류값 이름 일치
 */

const RESULT_LIMIT = 30;

function bayes(r: number | null, n: number) {
  if (r === null) return null;
  return (n * r + 8 * 3.6) / (n + 8);
}

function ratingScore(p: CrawledPlace) {
  const b = bayes(p.rating, p.ratingCount);
  return b === null ? 0.45 : Math.max(0, Math.min(1, (b - 2.8) / 2));
}

function popularity(p: CrawledPlace) {
  return Math.min(1, Math.log10(1 + p.reviewCount + p.blogReviewCount * 0.5) / 3);
}

function toScored(p: CrawledPlace, score: number, fit: number, reason: string, me: { lat: number; lng: number } | null): ScoredPlace {
  return {
    ...p,
    distance: me ? Math.round(haversine(me, p)) : p.distance,
    kakao:
      p.rating !== null || p.reviewCount
        ? { rating: p.rating, ratingCount: p.ratingCount, reviewCount: p.reviewCount, blogReviewCount: p.blogReviewCount, snippets: p.snippets, tags: p.tags }
        : null,
    naver: null,
    score: Math.round(score),
    scoreBreakdown: { rating: Math.round(ratingScore(p) * 100), popularity: Math.round(popularity(p) * 100), relevance: fit, distance: 0 },
    reason,
    highlights: [...p.menus.slice(0, 2).map((m) => m.name), ...p.tags.slice(0, 2)],
    aiRanked: false,
    attrs: p.attrs,
    fit,
  };
}

function ratingText(p: CrawledPlace) {
  return p.rating !== null ? ` 카카오 ★${p.rating.toFixed(1)}(${p.ratingCount}명).` : "";
}

export function rankByTheme(places: CrawledPlace[], theme: ThemePreset, me: { lat: number; lng: number } | null): ScoredPlace[] {
  return places
    .map((p) => {
      const fit = attrFit(p.attrs as Attrs, theme.attrs);
      const score = 0.5 * fit + 30 * ratingScore(p) + 20 * popularity(p);
      return { p, fit, score };
    })
    .filter((x) => x.fit >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, RESULT_LIMIT)
    .map(({ p, fit, score }) => {
      const why = topReasons(p.attrs as Attrs, theme.attrs);
      const reason = `${why.length ? `${why.join(", ")}(으)로 분류된 곳이에요.` : `'${theme.label}'에 어울리는 곳이에요.`}${ratingText(p)}`;
      return toScored(p, score, fit, reason, me);
    });
}

/** 검색어가 주제 이름이나 분류값 이름과 겹치면 그 분류값도 같이 본다 (예: "혼밥", "주차", "매운") */
function attrsFromText(tokens: string[]): Partial<Record<AttrKey, number>> {
  const w: Partial<Record<AttrKey, number>> = {};
  for (const t of tokens) {
    for (const [k, label] of Object.entries(ATTR_LABELS) as Array<[AttrKey, string]>) {
      if (label.includes(t) || t.includes(label.slice(0, 2))) w[k] = 1;
    }
    for (const th of THEME_PRESETS) {
      if (th.label.includes(t)) Object.assign(w, th.attrs);
    }
  }
  return w;
}

export function rankByText(places: CrawledPlace[], text: string, me: { lat: number; lng: number } | null): ScoredPlace[] {
  const tokens = text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
  if (!tokens.length) return [];
  const normTokens = tokens.map(normalizeName).filter(Boolean);
  const attrW = attrsFromText(tokens);
  const hasAttr = Object.keys(attrW).length > 0;

  return places
    .map((p) => {
      const fields = [
        [normalizeName(p.name), 3],
        [normalizeName(p.category), 2],
        [normalizeName(p.menus.map((m) => m.name).join(" ")), 2],
        [normalizeName(p.tags.join(" ")), 1.5],
        [normalizeName(p.snippets.join(" ")), 1],
      ] as const;
      let match = 0;
      for (const t of normTokens) for (const [f, w] of fields) if (f.includes(t)) match += w;
      const fit = hasAttr ? attrFit(p.attrs as Attrs, attrW) : 0;
      const relevance = Math.min(1, match / (3 * normTokens.length)) * 100;
      const rel = Math.max(relevance, fit);
      const score = 0.6 * rel + 25 * ratingScore(p) + 15 * popularity(p);
      return { p, rel, score, match };
    })
    .filter((x) => x.match > 0 || x.rel >= 35)
    .sort((a, b) => b.score - a.score)
    .slice(0, RESULT_LIMIT)
    .map(({ p, rel, score, match }) => {
      const reason = match > 0 ? `'${text}'와(과) 관련된 곳이에요.${ratingText(p)}` : `'${text}'에 어울리는 성격의 곳이에요.${ratingText(p)}`;
      return toScored(p, score, Math.round(rel), reason, me);
    });
}
