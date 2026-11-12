import { NextResponse } from "next/server";
import { z } from "zod";
import { recommend } from "@/lib/recommend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  lat: z.number().min(33).max(39), // 대한민국 범위
  lng: z.number().min(124).max(132),
  radius: z.number().int().min(200).max(5000).optional(),
  presetId: z.string().max(32).nullish(),
  text: z.string().max(200).nullish(),
});

// 아주 단순한 IP별 요청 제한 (외부 사이트 과다 호출 방지). 서버 여러 대면 Redis 등으로 교체.
const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 12;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "요청이 너무 많아요. 잠시 후 다시 시도해주세요." }, { status: 429 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않아요. (국내 위치만 지원)" }, { status: 400 });
  }

  try {
    const result = await recommend(body);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[recommend]", e);
    const message = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json({ error: `추천을 불러오지 못했어요: ${message}` }, { status: 502 });
  }
}
