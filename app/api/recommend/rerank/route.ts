import { NextResponse } from "next/server";
import { z } from "zod";
import { aiEnabled } from "@/lib/ai";
import { applyRerank } from "@/lib/recommend";
import { cacheGet, cachePut } from "@/lib/store";
import type { ScoredPlace, ThemeQuery } from "@/lib/types";
import { hashKey } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  query: z.object({ summary: z.string().max(300), boost: z.array(z.string()).max(20), avoid: z.array(z.string()).max(20) }).passthrough(),
  places: z.array(z.object({ id: z.string().max(40), name: z.string().max(100) }).passthrough()).min(1).max(30),
});

/** 빠른 추천 결과를 AI가 리뷰를 읽고 다시 정렬 (앱이 결과를 먼저 보여준 뒤 이어서 요청) */
export async function POST(req: Request) {
  if (!aiEnabled()) return NextResponse.json({ error: "AI 키가 없어요." }, { status: 503 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }
  const query = body.query as unknown as ThemeQuery;
  const places = body.places as unknown as ScoredPlace[];
  const key = `rr:v1:${hashKey(`${query.summary}|${places.map((p) => p.id).join(",")}`)}`;
  const cached = await cacheGet<ScoredPlace[]>(key);
  if (cached) return NextResponse.json({ places: cached }, { headers: { "X-Cache": "HIT" } });
  try {
    const reranked = await applyRerank(query, places);
    await cachePut(key, reranked, 60 * 60);
    return NextResponse.json({ places: reranked });
  } catch (e) {
    console.error("[recommend/rerank]", e);
    return NextResponse.json({ error: "AI 정렬 실패" }, { status: 502 });
  }
}
