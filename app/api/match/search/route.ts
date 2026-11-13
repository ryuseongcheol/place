import { NextResponse } from "next/server";
import { z } from "zod";
import { Budget } from "@/lib/budget";
import { searchPlaces } from "@/lib/merchantMatch";
import { isMockMode } from "@/lib/recommend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  q: z.string().min(1).max(60),
  lat: z.number().min(33).max(39).nullish(),
  lng: z.number().min(124).max(132).nullish(),
});

/** 타임라인 결제 기록의 장소 바꾸기: 가게 이름으로 카카오 장소 검색 (위치가 있으면 가까운 순) */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  const { q, lat, lng } = parsed.data;
  if (isMockMode()) return NextResponse.json({ places: [] });
  try {
    const places = await searchPlaces(q, lat != null && lng != null ? { lat, lng } : null, new Budget(2));
    return NextResponse.json({ places });
  } catch (e) {
    console.error("[match/search]", e);
    return NextResponse.json({ error: "장소를 찾지 못했어요." }, { status: 502 });
  }
}
