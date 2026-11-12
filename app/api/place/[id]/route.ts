import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlaceDetail } from "@/lib/placeDetail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  id: z.string().regex(/^[\w-]{1,40}$/),
  name: z.string().min(1).max(80),
  lat: z.coerce.number().min(33).max(39),
  lng: z.coerce.number().min(124).max(132),
  naverId: z.string().regex(/^\d{1,20}$/).nullish(),
});

const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 40;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) return NextResponse.json({ error: "요청이 너무 많아요. 잠시 후 다시 시도해주세요." }, { status: 429 });

  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const parsed = Query.safeParse({
    id,
    name: sp.get("name"),
    lat: sp.get("lat"),
    lng: sp.get("lng"),
    naverId: sp.get("naverId") || null,
  });
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });

  try {
    const detail = await getPlaceDetail({ ...parsed.data, naverId: parsed.data.naverId ?? null });
    return NextResponse.json(detail, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    console.error("[place]", e);
    return NextResponse.json({ error: "식당 정보를 불러오지 못했어요." }, { status: 502 });
  }
}
