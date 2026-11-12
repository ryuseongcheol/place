// 서버(../../lib/types.ts)와 같은 내용. 서버 응답 형식을 바꾸면 여기도 같이 바꿀 것.
export interface LatLng {
  lat: number;
  lng: number;
}

/** 카카오 로컬 API에서 가져온 기본 장소 정보 (공식) */
export interface BasePlace {
  id: string; // 카카오 place id
  name: string;
  category: string; // "음식점 > 한식 > 국밥"
  address: string;
  roadAddress: string;
  phone: string;
  lat: number;
  lng: number;
  distance: number; // m
  kakaoUrl: string;
  /** 검색 결과에서의 정확도 순위 (0이 가장 정확) */
  searchRank: number;
  /** 이 장소를 찾게 한 검색어 */
  matchedKeywords: string[];
}

export interface KakaoReviewInfo {
  rating: number | null; // 0~5
  ratingCount: number;
  reviewCount: number;
  blogReviewCount: number;
  snippets: string[];
  tags: string[];
}

export interface NaverReviewInfo {
  naverId: string | null;
  visitorReviewCount: number;
  blogReviewCount: number;
  rating: number | null; // 네이버는 대부분 비공개. 있을 때만.
  keywords: string[]; // "음식이 맛있어요" 같은 키워드 리뷰/마이크로 리뷰
  naverUrl: string;
}

export interface ScoredPlace extends BasePlace {
  kakao: KakaoReviewInfo | null;
  naver: NaverReviewInfo | null;
  score: number; // 0~100
  scoreBreakdown: { rating: number; popularity: number; relevance: number; distance: number };
  reason: string;
  highlights: string[];
  aiRanked: boolean;
}

export interface ThemeQuery {
  keywords: string[]; // 카카오 검색에 쓸 검색어 (1~4개)
  includeCafe: boolean;
  avoid: string[]; // 제외할 업종/키워드
  boost: string[]; // 리뷰·카테고리에 있으면 가산점
  summary: string; // 사용자가 원하는 것을 한 문장으로
  weights: { rating: number; popularity: number; relevance: number; distance: number };
}

export interface RecommendRequest {
  lat: number;
  lng: number;
  radius?: number; // m
  presetId?: string | null;
  text?: string | null;
}

export type SourceStatus = "ok" | "partial" | "failed" | "disabled" | "mock";

export interface RecommendResponse {
  query: ThemeQuery;
  region: string | null;
  places: ScoredPlace[];
  sources: {
    kakaoSearch: SourceStatus;
    kakaoReviews: SourceStatus;
    naverReviews: SourceStatus;
    ai: SourceStatus;
  };
  warnings: string[];
}
