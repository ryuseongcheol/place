import { NextResponse } from "next/server";
import { z } from "zod";
import { requestBudget } from "@/lib/budget";
import { crawlListChunk } from "@/lib/crawl";
import { mockRegionPlaces } from "@/lib/mock";
import { isMockMode } from "@/lib/recommend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Rect = z.object({
  minLng: z.number(),
  minLat: z.number(),
  maxLng: z.number(),
  maxLat: z.number(),
  code: z.enum(["FD6", "CE7"]),
  depth: z.number().int().min(0).max(8),
  page: z.number().int().min(1).max(3),
});
const Body = z.object({
  region: z.object({
    id: z.string().max(40),
    name: z.string().max(40),
    fullName: z.string().max(80),
    lat: z.number().min(33).max(39),
    lng: z.number().min(124).max(132),
    radius: z.number().int().min(200).max(2000),
  }),
  cursor: z.object({ queue: z.array(Rect).max(400) }).nullable(),
});

/** 지역 식당 목록 수집 한 덩어리 (앱이 cursor가 null이 될 때까지 반복 호출) */
export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }
  if (isMockMode()) {
    const all = mockRegionPlaces(body.region);
    const half = Math.ceil(all.length / 2);
    const first = body.cursor === null;
    return NextResponse.json({
      places: first ? all.slice(0, half) : all.slice(half),
      cursor: first ? { queue: [] } : null,
      calls: 0,
    });
  }
  try {
    const res = await crawlListChunk(body.region, body.cursor, requestBudget());
    return NextResponse.json(res);
  } catch (e) {
    console.error("[crawl/list]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "목록 수집 실패" }, { status: 502 });
  }
}
