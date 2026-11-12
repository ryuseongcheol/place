import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ATTR_KEYS, ATTR_LABELS, type AttrKey, type Attrs } from "./classify";
import type { AiClassifyInput } from "./types";

/**
 * 수집한 식당을 Claude가 직접 읽고 숨은 분류값을 매긴다.
 * 키워드 규칙보다 메뉴·후기 맥락을 훨씬 잘 읽는다 ("조용해서 좋았는데 주말엔 시끄러움" 같은 것).
 * 평판 기반 값(hiddenGem, hot)은 별점·리뷰 수로 계산하므로 AI에게 맡기지 않는다.
 */

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const AI_KEYS = ATTR_KEYS.filter((k) => !["hiddenGem", "hot", "tvShow", "guide"].includes(k)) as Exclude<AttrKey, "hiddenGem" | "hot" | "tvShow" | "guide">[];

const Schema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      scores: z.array(z.object({ key: z.enum(AI_KEYS as [string, ...string[]]), score: z.number() })),
    }),
  ),
});

const SYSTEM = `너는 한국 식당을 잘 아는 미식가다. 각 식당의 카테고리, 대표 메뉴와 가격, 강점 태그, 손님 후기를 읽고
아래 성질마다 0~1 점수를 매긴다. 근거가 없는 성질은 빼고(0으로 간주), 0.2 이상인 것만 적는다.
- 1.0: 이 식당의 핵심 성격 (예: 1인석 위주 라멘집의 '혼자 먹기 편함')
- 0.6: 분명히 해당됨
- 0.3: 어느 정도 해당
업종으로 당연히 추론되는 것도 반영한다 (예: 오마카세 → 특별한 날·데이트, 기사식당 → 가성비·혼자, 포장마차 → 술·늦게까지).
후기에 반대 증거가 있으면 낮춘다 (예: "시끄러워요" → 조용함 낮게).

성질 목록:
${AI_KEYS.map((k) => `${k}: ${ATTR_LABELS[k]}`).join("\n")}`;

export function aiClassifyEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;

export async function aiClassify(places: AiClassifyInput[]): Promise<Array<{ id: string; attrs: Attrs }>> {
  client ??= new Anthropic({ maxRetries: 2, timeout: 90_000 });
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(Schema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `다음 식당 ${places.length}곳을 모두 평가해줘. id는 그대로 돌려줘.\n${JSON.stringify(places)}`,
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`AI 분류 실패: ${res.stop_reason}`);
  const valid = new Set(places.map((p) => p.id));
  return res.parsed_output.items
    .filter((it) => valid.has(it.id))
    .map((it) => {
      const attrs: Attrs = {};
      for (const s of it.scores) {
        const v = Math.max(0, Math.min(1, s.score));
        if (v >= 0.15) attrs[s.key as AttrKey] = Math.round(v * 100) / 100;
      }
      return { id: it.id, attrs };
    });
}

export { mergeAttrs } from "./classify";
