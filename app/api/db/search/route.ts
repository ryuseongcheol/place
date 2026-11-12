import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, searchDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  lat: z.coerce.number().min(33).max(39),
  lng: z.coerce.number().min(124).max(132),
  radius: z.coerce.number().int().min(200).max(5000).default(1000),
  theme: z.string().max(32).nullish(),
  q: z.string().max(100).nullish(),
});

/** 저장된 DB에서 위치·주제/검색어로 추천 */
export async function GET(req: Request) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: "DB가 연결되지 않았어요." }, { status: 503 });
  const sp = new URL(req.url).searchParams;
  const parsed = Query.safeParse({ lat: sp.get("lat"), lng: sp.get("lng"), radius: sp.get("radius") ?? undefined, theme: sp.get("theme"), q: sp.get("q") });
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  try {
    const r = await searchDb(db, { lat: parsed.data.lat, lng: parsed.data.lng, radius: parsed.data.radius, themeId: parsed.data.theme, q: parsed.data.q });
    return NextResponse.json(r);
  } catch (e) {
    console.error("[db/search]", e);
    return NextResponse.json({ error: "DB 검색 실패" }, { status: 502 });
  }
}
