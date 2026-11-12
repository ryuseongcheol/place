import { NextResponse } from "next/server";
import { regionAt, searchRegions, type RegionHit } from "@/lib/kakao";
import { isMockMode } from "@/lib/recommend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOCK: RegionHit[] = [
  { id: "mock-1168064000", name: "역삼1동", fullName: "서울 강남구 역삼1동", lat: 37.4995, lng: 127.0333 },
  { id: "mock-1120069000", name: "성수1가1동", fullName: "서울 성동구 성수1가1동", lat: 37.5447, lng: 127.0557 },
  { id: "mock-1144066000", name: "서교동", fullName: "서울 마포구 서교동", lat: 37.5552, lng: 126.9198 },
  { id: "mock-1111061500", name: "종로1·2·3·4가동", fullName: "서울 종로구 종로1·2·3·4가동", lat: 37.5704, lng: 126.9921 },
  { id: "mock-1165051000", name: "서초2동", fullName: "서울 서초구 서초2동", lat: 37.4917, lng: 127.0257 },
  { id: "mock-1121581000", name: "화양동", fullName: "서울 광진구 화양동", lat: 37.5467, lng: 127.0703 },
];

/** 지역(동) 찾기: ?q=역삼 또는 ?lat=..&lng=.. (현재 위치의 동) */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim().slice(0, 40);
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  try {
    if (isMockMode()) {
      if (q) return NextResponse.json({ regions: MOCK.filter((r) => r.fullName.includes(q)) });
      return NextResponse.json({ regions: [MOCK[0]] });
    }
    if (q) return NextResponse.json({ regions: await searchRegions(q) });
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const r = await regionAt({ lat, lng });
      return NextResponse.json({ regions: r ? [r] : [] });
    }
    return NextResponse.json({ error: "q 또는 lat/lng가 필요해요." }, { status: 400 });
  } catch (e) {
    console.error("[regions]", e);
    return NextResponse.json({ error: "지역을 찾지 못했어요." }, { status: 502 });
  }
}
