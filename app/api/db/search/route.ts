import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, searchDb } from "@/lib/db";
import { themeFromDef } from "@/lib/themes";
import { ThemeDefSchema } from "@/lib/themeSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  lat: z.coerce.number().min(33).max(39),
  lng: z.coerce.number().min(124).max(132),
  radius: z.coerce.number().int().min(200).max(5000).default(1000),
  theme: z.string().max(32).nullish(),
  q: z.string().max(100).nullish(),
  offset: z.coerce.number().int().min(0).max(600).default(0),
});

/** 저장된 DB에서 위치·주제/검색어로 추천 */
export async function GET(req: Request) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: "DB가 연결되지 않았어요." }, { status: 503 });
  const sp = new URL(req.url).searchParams;
  const parsed = Query.safeParse({ lat: sp.get("lat"), lng: sp.get("lng"), radius: sp.get("radius") ?? undefined, theme: sp.get("theme"), q: sp.get("q"), offset: sp.get("offset") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  try {
    const r = await searchDb(db, { lat: parsed.data.lat, lng: parsed.data.lng, radius: parsed.data.radius, themeId: parsed.data.theme, q: parsed.data.q, offset: parsed.data.offset });
    return NextResponse.json(r);
  } catch (e) {
    console.error("[db/search]", e);
    return NextResponse.json({ error: "DB 검색 실패" }, { status: 502 });
  }
}

const Body = z.object({
  lat: z.number().min(33).max(39),
  lng: z.number().min(124).max(132),
  radius: z.number().int().min(200).max(5000).default(1000),
  theme: ThemeDefSchema.nullish(),
  q: z.string().max(100).nullish(),
  /** 더 보기: 이미 받은 수 */
  offset: z.number().int().min(0).max(600).default(0),
});

/** 고친 주제·새 주제·여러 주제를 합친 것으로 찾기 (주제 내용을 같이 보낸다) */
export async function POST(req: Request) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: "DB가 연결되지 않았어요." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  const b = parsed.data;
  try {
    const r = await searchDb(db, { lat: b.lat, lng: b.lng, radius: b.radius, theme: b.theme ? themeFromDef(b.theme) : null, q: b.q, offset: b.offset });
    return NextResponse.json(r);
  } catch (e) {
    console.error("[db/search]", e);
    return NextResponse.json({ error: "DB 검색 실패" }, { status: 502 });
  }
}
