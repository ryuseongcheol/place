import { NextResponse } from "next/server";
import { z } from "zod";
import { Budget } from "@/lib/budget";
import { matchMerchant, type MerchantMatch } from "@/lib/merchantMatch";
import { isMockMode } from "@/lib/recommend";
import { cacheGet, cachePut } from "@/lib/store";
import { hashKey } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  items: z
    .array(
      z.object({
        id: z.string().max(200),
        merchant: z.string().min(1).max(80),
        lat: z.number().min(33).max(39).nullish(),
        lng: z.number().min(124).max(132).nullish(),
      }),
    )
    .max(40),
});

/** 결제 알림 가맹점 → 카카오 장소. 한 번에 최대 20곳 (외부 호출 예산 때문에), 나머지는 다음 요청에서 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  const items = parsed.data.items;
  if (isMockMode()) {
    return NextResponse.json({ results: items.map((i) => ({ id: i.id, result: { status: "unmatched" } as MerchantMatch })) });
  }
  const budget = new Budget(40);
  const results: Array<{ id: string; result: MerchantMatch }> = [];
  for (const it of items) {
    const loc = it.lat != null && it.lng != null ? { lat: it.lat, lng: it.lng } : null;
    const key = `mm:v1:${hashKey(`${it.merchant}|${loc ? `${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}` : "-"}`)}`;
    const cached = await cacheGet<MerchantMatch>(key);
    if (cached) {
      results.push({ id: it.id, result: cached });
      continue;
    }
    if (budget.remaining < 3) break; // 다음 요청에서
    try {
      const r = await matchMerchant(it.merchant, loc, budget);
      results.push({ id: it.id, result: r });
      await cachePut(key, r, r.status === "unmatched" ? 3 * 86400 : 30 * 86400);
    } catch (e) {
      console.error("[match/merchants]", e);
      break;
    }
  }
  return NextResponse.json({ results });
}
