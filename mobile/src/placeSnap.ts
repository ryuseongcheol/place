import type { BasePlace, ScoredPlace } from "./types";

/** 타임라인·결제 기록에 남겨 두는 식당 정보 (나중에 상세를 다시 열 수 있을 만큼) */
export interface PlaceSnap {
  id: string;
  name: string;
  category: string;
  address: string;
  roadAddress: string;
  phone: string;
  lat: number;
  lng: number;
  kakaoUrl: string;
}

export function snapOf(p: Pick<BasePlace, "id" | "name" | "category" | "address" | "roadAddress" | "phone" | "lat" | "lng" | "kakaoUrl">): PlaceSnap {
  return {
    id: p.id,
    name: p.name,
    category: p.category ?? "",
    address: p.address ?? "",
    roadAddress: p.roadAddress ?? "",
    phone: p.phone ?? "",
    lat: p.lat,
    lng: p.lng,
    kakaoUrl: p.kakaoUrl ?? `https://place.map.kakao.com/${p.id}`,
  };
}

/** 저장해 둔 정보로 상세 화면을 열 수 있게 ScoredPlace 모양으로 */
export function snapToScored(s: PlaceSnap): ScoredPlace {
  return {
    ...s,
    distance: 0,
    searchRank: 0,
    matchedKeywords: [],
    kakao: null,
    naver: null,
    score: 0,
    scoreBreakdown: { rating: 0, popularity: 0, relevance: 0, distance: 0 },
    reason: "",
    highlights: [],
    aiRanked: false,
  };
}
