import { NextResponse } from "next/server";
import { z } from "zod";
import { requestBudget } from "@/lib/budget";
import { classify } from "@/lib/classify";
import { crawlDetailChunk } from "@/lib/crawl";
import { mockCrawlDetail, mockKakao } from "@/lib/mock";
import { isMockMode } from "@/lib/recommend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  places: z
    .array(z.object({ id: z.string().regex(/^[\w-]{1,40}$/), name: z.string().max(80), category: z.string().max(120) }))
    .min(1)
    .max(20),
});

/** 식당 상세 + 숨은 분류값 (앱이 카카오 상세를 직접 못 가져올 때 쓰는 대체 경로) */
export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }
  if (isMockMode()) {
    const items = body.places.map((p) => {
      const k = mockKakao(p.id);
      const { menus } = mockCrawlDetail(p);
      const { attrs, priceLevel } = classify({
        name: p.name,
        category: p.category,
        menus,
        tags: k?.tags ?? [],
        snippets: k?.snippets ?? [],
        rating: k?.rating ?? null,
        ratingCount: k?.ratingCount ?? 0,
        reviewCount: k?.reviewCount ?? 0,
        blogReviewCount: k?.blogReviewCount ?? 0,
      });
      return {
        id: p.id,
        ok: true,
        rating: k?.rating ?? null,
        ratingCount: k?.ratingCount ?? 0,
        reviewCount: k?.reviewCount ?? 0,
        blogReviewCount: k?.blogReviewCount ?? 0,
        menus,
        tags: k?.tags ?? [],
        snippets: k?.snippets ?? [],
        openHours: [],
        attrs,
        priceLevel,
      };
    });
    return NextResponse.json({ items });
  }
  try {
    return NextResponse.json({ items: await crawlDetailChunk(body.places, requestBudget()) });
  } catch (e) {
    console.error("[crawl/detail]", e);
    return NextResponse.json({ error: "상세 수집 실패" }, { status: 502 });
  }
}
