import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ATTR_KEYS, ATTR_LABELS, type AttrKey } from "./classify";
import type { ScoredPlace, ThemeQuery } from "./types";
import type { ThemePreset } from "./themes";
import { DEFAULT_WEIGHTS } from "./themes";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
function getClient() {
  if (!client) client = new Anthropic({ maxRetries: 1, timeout: 25_000 });
  return client;
}

// ---------- 1) 자유 입력 주제 → 검색 조건 ----------

const ThemeSchema = z.object({
  keywords: z.array(z.string()).describe("카카오맵 키워드 검색에 그대로 넣을 짧은 검색어 4~6개 (예: '국밥', '평양냉면', '오마카세')"),
  includeCafe: z.boolean().describe("카페/디저트/베이커리도 후보에 포함해야 하면 true"),
  avoid: z.array(z.string()).describe("업종명·카테고리에 있으면 제외할 단어"),
  boost: z.array(z.string()).describe("리뷰·카테고리에 있으면 주제에 잘 맞는다는 신호가 되는 단어 3~8개"),
  summary: z.string().describe("사용자가 원하는 식당을 한국어 한 문장으로 요약"),
  attrs: z
    .array(z.object({ key: z.enum(ATTR_KEYS), weight: z.number() }))
    .describe("식당 성질 키와 가중치(-1~1). 원하는 성질은 양수, 피하고 싶은 성질은 음수. 2~6개"),
  weights: z
    .object({
      rating: z.number(),
      popularity: z.number(),
      relevance: z.number(),
      distance: z.number(),
    })
    .describe("각 요소 가중치 (합이 1). 예: 급하면 distance↑, 특별한 날이면 rating↑"),
});

const THEME_SYSTEM = `너는 한국 맛집 검색 도우미다. 사용자의 상황/주제 설명을 카카오맵 키워드 검색 조건으로 바꾼다.
- keywords는 음식 종류나 업종처럼 지도 검색에서 실제로 결과가 잘 나오는 짧은 단어로 쓴다. 문장, 지명, '맛집'만 단독으로 쓰지 않는다.
- 주제가 모호하면 그 상황에 어울리는 서로 다른 음식 종류로 다양하게 고른다.
- 위치는 별도로 처리하므로 지역명은 넣지 않는다.
- attrs는 아래 식당 성질 중에서 고른다:
${ATTR_KEYS.map((k) => `  ${k}: ${ATTR_LABELS[k]}`).join("\n")}`;

export async function parseTheme(preset: ThemePreset | undefined, text: string): Promise<ThemeQuery> {
  const userMsg = [
    preset ? `선택한 테마: ${preset.label} — ${preset.description}` : null,
    text ? `사용자 입력: ${text}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: zodOutputFormat(ThemeSchema) },
    system: THEME_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`theme parse failed: ${res.stop_reason}`);
  const out = res.parsed_output;
  const w = out.weights;
  const sum = w.rating + w.popularity + w.relevance + w.distance;
  const attrWeights: Partial<Record<AttrKey, number>> = { ...(preset?.attrs ?? {}) };
  for (const a of out.attrs) attrWeights[a.key] = Math.max(-1, Math.min(1, a.weight));
  return {
    themeId: preset?.id ?? null,
    attrWeights,
    keywords: out.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 6),
    includeCafe: out.includeCafe || Boolean(preset?.includeCafe),
    avoid: out.avoid.slice(0, 8),
    boost: out.boost.slice(0, 10),
    summary: out.summary,
    weights:
      sum > 0
        ? { rating: w.rating / sum, popularity: w.popularity / sum, relevance: w.relevance / sum, distance: w.distance / sum }
        : DEFAULT_WEIGHTS,
  };
}

// ---------- 2) 리뷰 기반 재정렬 + 추천 이유 ----------

const RerankSchema = z.object({
  picks: z
    .array(
      z.object({
        id: z.string().describe("후보의 id 그대로"),
        fit: z.number().describe("주제 적합도 0~100"),
        reason: z.string().describe("이 주제에 왜 맞는지 리뷰·별점 근거를 들어 한국어 1~2문장"),
        highlights: z.array(z.string()).describe("짧은 특징 태그 2~4개 (예: '1인석', '24시', '웨이팅 있음')"),
      }),
    )
    .describe("주제에 맞는 순서대로 정렬. 주제와 명백히 안 맞는 곳은 넣지 않는다."),
});

const RERANK_SYSTEM = `너는 리뷰를 꼼꼼히 읽는 한국 맛집 큐레이터다. 주어진 후보 식당의 카테고리, 카카오맵 별점/후기, 네이버 리뷰 수/키워드, 거리를 보고
사용자의 주제에 가장 잘 맞는 순서로 고른다.
- 근거는 주어진 데이터에서만 가져온다. 데이터에 없는 메뉴·가격·분위기를 지어내지 않는다.
- 리뷰가 적은 높은 별점은 신뢰도가 낮다는 점을 감안한다.
- 리뷰 정보가 없으면 카테고리와 이름으로 판단하고, 이유에 '리뷰 정보가 적다'는 점을 밝힌다.`;

export async function rerank(
  q: ThemeQuery,
  places: ScoredPlace[],
  maxPicks = 20,
): Promise<Map<string, { fit: number; reason: string; highlights: string[]; order: number }>> {
  const candidates = places.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    distance_m: p.distance,
    kakao_rating: p.kakao?.rating ?? null,
    kakao_rating_count: p.kakao?.ratingCount ?? 0,
    kakao_reviews: p.kakao?.snippets.slice(0, 4) ?? [],
    kakao_tags: p.kakao?.tags ?? [],
    naver_visitor_reviews: p.naver?.visitorReviewCount ?? null,
    naver_blog_reviews: p.naver?.blogReviewCount ?? null,
    naver_keywords: p.naver?.keywords ?? [],
    signals: Object.entries(p.attrs ?? {})
      .filter(([, v]) => (v ?? 0) >= 0.4)
      .map(([k]) => ATTR_LABELS[k as AttrKey])
      .slice(0, 6),
    theme_fit: p.fit ?? null,
    heuristic_score: p.score,
  }));

  const res = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 12000,
    output_config: { effort: "medium", format: zodOutputFormat(RerankSchema) },
    system: RERANK_SYSTEM,
    messages: [
      {
        role: "user",
        content: `주제: ${q.summary}\n선호 신호: ${q.boost.join(", ") || "없음"}\n피할 것: ${q.avoid.join(", ") || "없음"}\n\n후보 (JSON):\n${JSON.stringify(candidates)}\n\n주제에 맞는 곳을 최대 ${maxPicks}곳 골라줘. 주제와 명백히 안 맞는 곳만 빼고, 애매하면 순위를 낮춰서 포함해.`,
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`rerank failed: ${res.stop_reason}`);

  const valid = new Set(places.map((p) => p.id));
  const map = new Map<string, { fit: number; reason: string; highlights: string[]; order: number }>();
  res.parsed_output.picks.forEach((pick, i) => {
    if (valid.has(pick.id) && !map.has(pick.id)) {
      map.set(pick.id, {
        fit: Math.max(0, Math.min(100, pick.fit)),
        reason: pick.reason,
        highlights: pick.highlights.slice(0, 4),
        order: i,
      });
    }
  });
  return map;
}
