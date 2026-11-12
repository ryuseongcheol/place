import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "regions";
const Region = z.object({
  id: z.string().max(40),
  name: z.string().max(40),
  fullName: z.string().max(80),
  lat: z.number().min(33).max(39),
  lng: z.number().min(124).max(132),
  radius: z.number().int().min(200).max(2000),
});

/** 매일 밤 서버 수집(GitHub Actions)이 읽는 지역 목록 */
export async function GET() {
  const { kv, persistent } = getStore();
  const v = await kv.get(KEY);
  const data = v ? JSON.parse(v) : { regions: [], updatedAt: null };
  return NextResponse.json({ ...data, persistent });
}

/** 앱이 고른 지역 목록 저장 (최대 5곳) */
export async function PUT(req: Request) {
  let regions: z.infer<typeof Region>[];
  try {
    regions = z.object({ regions: z.array(Region).max(5) }).parse(await req.json()).regions;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }
  const { kv, persistent } = getStore();
  await kv.put(KEY, JSON.stringify({ regions, updatedAt: Date.now() }));
  return NextResponse.json({ ok: true, persistent });
}
