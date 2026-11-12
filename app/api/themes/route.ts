import { NextResponse } from "next/server";
import { THEME_PRESETS } from "@/lib/themes";
import { aiEnabled } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { isMockMode } from "@/lib/recommend";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    presets: THEME_PRESETS.map(({ id, label, emoji }) => ({ id, label, emoji })),
    ai: aiEnabled(),
    mock: isMockMode(),
    // 배포 확인용: 어느 커밋이 배포됐는지, 어떤 키가 들어가 있는지 (값은 노출하지 않음)
    version: process.env.BUILD_SHA ?? "unknown",
    builtAt: process.env.BUILD_TIME ?? null,
    features: ["recommend", "place-detail", "db"],
    keys: {
      kakao: Boolean(process.env.KAKAO_REST_API_KEY),
      naverHub: Boolean(process.env.NAVER_HUB_CLIENT_ID && process.env.NAVER_HUB_CLIENT_SECRET),
      naverLegacy: Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      db: getDb() !== null,
    },
  });
}
