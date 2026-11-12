import { NextResponse } from "next/server";
import { z } from "zod";
import { requestBudget } from "@/lib/budget";
import { regionName } from "@/lib/kakao";
import { naverSearchEnabled, naverShowSearch } from "@/lib/naver";
import { isMockMode } from "@/lib/recommend";
import { mapLimit } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  region: z.object({ lat: z.number(), lng: z.number() }).optional(),
  places: z.array(z.object({ id: z.string().regex(/^[\w-]{1,40}$/), name: z.string().max(80) })).min(1).max(40),
});

/** 수집한 식당들의 방송·가이드 출연 확인 (네이버 블로그 검색, NAVER API HUB 키 필요) */
export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }
  if (isMockMode()) {
    return NextResponse.json({ items: body.places.map((p) => ({ id: p.id, shows: Number(p.id.replace(/\D/g, "")) % 4 === 0 ? ["wednesday"] : [] })) });
  }
  if (!naverSearchEnabled()) return NextResponse.json({ error: "네이버 검색 키가 없어 방송 출연을 확인할 수 없어요." }, { status: 503 });
  const budget = requestBudget();
  const region = body.region ? await regionName(body.region, budget) : null;
  const items = await mapLimit(body.places, 6, async (p) => ({ id: p.id, shows: await naverShowSearch(p.name, region, budget) }));
  // 예산이 모자라 확인 못 한 곳(null)은 빼고 돌려준다 (앱이 다음에 다시 요청)
  return NextResponse.json({ items: items.filter((i) => i.shows !== null) });
}
