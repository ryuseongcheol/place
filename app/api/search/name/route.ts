import { NextResponse } from "next/server";
import { z } from "zod";
import { searchByName } from "@/lib/nameSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  q: z.string().trim().min(2).max(40),
  lat: z.coerce.number().min(33).max(39),
  lng: z.coerce.number().min(124).max(132),
});

/** 가게 이름으로 찾기: ?q=오도로키&lat=..&lng=.. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const parsed = Query.safeParse({ q: sp.get("q"), lat: sp.get("lat"), lng: sp.get("lng") });
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  try {
    return NextResponse.json(await searchByName(parsed.data.q, { lat: parsed.data.lat, lng: parsed.data.lng }));
  } catch (e) {
    console.error("[search/name]", e);
    return NextResponse.json({ error: "가게를 찾지 못했어요." }, { status: 502 });
  }
}
