import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, upsertPlaces } from "@/lib/db";
import type { CrawledPlace } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Place = z
  .object({
    id: z.string().regex(/^\d{1,20}$/), // 카카오 place id만 (예시 데이터는 저장하지 않음)
    name: z.string().max(100),
    category: z.string().max(200),
    lat: z.number().min(33).max(39),
    lng: z.number().min(124).max(132),
  })
  .passthrough();

/** 앱이 수집한 식당을 DB에 저장 (정보가 더 적은 결과는 기존 것을 덮지 않음) */
export async function POST(req: Request) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: "DB가 연결되지 않았어요." }, { status: 503 });
  let places: CrawledPlace[];
  try {
    places = z.object({ places: z.array(Place).min(1).max(30) }).parse(await req.json()).places as unknown as CrawledPlace[];
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }
  try {
    await upsertPlaces(db, places);
    return NextResponse.json({ ok: true, saved: places.length });
  } catch (e) {
    console.error("[db/places]", e);
    return NextResponse.json({ error: "DB 저장 실패" }, { status: 502 });
  }
}
