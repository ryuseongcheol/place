import { NextResponse } from "next/server";
import { THEME_PRESETS } from "@/lib/themes";
import { aiEnabled } from "@/lib/ai";
import { isMockMode } from "@/lib/recommend";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    presets: THEME_PRESETS.map(({ id, label, emoji }) => ({ id, label, emoji })),
    ai: aiEnabled(),
    mock: isMockMode(),
  });
}
