import { NextResponse } from "next/server";
import { z } from "zod";
import { aiClassify, aiClassifyEnabled } from "@/lib/aiClassify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  places: z
    .array(
      z.object({
        id: z.string().regex(/^[\w-]{1,40}$/),
        name: z.string().max(80),
        category: z.string().max(120),
        priceLevel: z.number().nullable(),
        menus: z.array(z.string().max(60)).max(12),
        tags: z.array(z.string().max(40)).max(16),
        reviews: z.array(z.string().max(200)).max(8),
        openHours: z.array(z.string().max(60)).max(4),
      }),
    )
    .min(1)
    .max(25),
});

/** 수집한 식당 묶음을 AI로 분류 (ANTHROPIC_API_KEY 필요) */
export async function POST(req: Request) {
  if (!aiClassifyEnabled()) return NextResponse.json({ error: "ANTHROPIC_API_KEY가 없어 AI 분류를 쓸 수 없어요." }, { status: 503 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }
  try {
    return NextResponse.json({ items: await aiClassify(body.places) });
  } catch (e) {
    console.error("[crawl/ai]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 분류 실패" }, { status: 502 });
  }
}
