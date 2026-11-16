import { z } from "zod";

/** 앱이 보내는 주제 내용 검사 (lib/themes.ts 의 ThemeDef). 실제 값 정리는 themeFromDef 가 한다 */
export const ThemeDefSchema = z.object({
  id: z.string().max(200).optional(),
  ids: z.array(z.string().max(32)).max(20).optional(),
  label: z.string().max(120),
  emoji: z.string().max(16),
  description: z.string().max(400),
  keywords: z.array(z.string().max(40)).max(20),
  includeCafe: z.boolean(),
  avoid: z.array(z.string().max(40)).max(30),
  attrs: z.record(z.string().max(20), z.number().min(-5).max(5)),
  weights: z.object({ rating: z.number().min(0).max(1), popularity: z.number().min(0).max(1), relevance: z.number().min(0).max(1), distance: z.number().min(0).max(1) }),
});
