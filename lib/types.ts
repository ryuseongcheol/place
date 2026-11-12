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
  /** 숨은 분류값 (화면에는 직접 보여주지 않음) */
  attrs?: Partial<Record<string, number>>;
  /** 주제 적합도 0~100 */
  fit?: number;
}

export interface ThemeQuery {
  /** 고른 주제 id (자유 입력만 했으면 null) */
  themeId: string | null;
  keywords: string[]; // 카카오 검색에 쓸 검색어 (1~6개)
  includeCafe: boolean;
  avoid: string[]; // 제외할 업종/키워드
  boost: string[]; // 리뷰·카테고리에 있으면 가산점
  /** 숨은 분류값 가중치 (lib/classify.ts의 AttrKey). 주제 적합도 계산에 사용 */
  attrWeights: Partial<Record<string, number>>;
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

// ---------- 식당 상세 (/api/place/[id]) ----------

export interface MenuItem {
  name: string;
  price: string | null;
  image: string | null;
}

export interface ReviewItem {
  text: string;
  rating: number | null;
  date: string | null;
  author: string | null;
  photos: string[];
}

export interface BlogReview {
  title: string;
  snippet: string;
  url: string;
  blogger: string | null;
  date: string | null;
  thumbnail: string | null;
  source: "kakao" | "naver";
}

export interface PlaceDetail {
  id: string;
  photos: string[];
  photoSource: "kakao" | "naver" | null;
  menus: MenuItem[];
  openHours: string[];
  homepage: string | null;
  kakaoReviews: ReviewItem[];
  blogReviews: BlogReview[];
  /** 네이버 블로그 검색 결과 총 건수 (가게명+동네로 검색한 대략치) */
  blogReviewTotal: number | null;
  links: {
    kakaoPlace: string;
    kakaoReviews: string;
    naverPlace: string;
    naverVisitorReviews: string;
    naverBlogReviews: string;
  };
  sources: { kakaoDetail: SourceStatus; naverBlog: SourceStatus; naverImage: SourceStatus };
}

// ---------- 지역 미리 수집 (/api/regions, /api/crawl) ----------

export interface Region {
  /** 행정동 코드 등 고유값 */
  id: string;
  /** 짧은 이름 (예: 역삼1동) */
  name: string;
  /** 전체 이름 (예: 서울 강남구 역삼1동) */
  fullName: string;
  lat: number;
  lng: number;
  /** 수집 반경 (m) */
  radius: number;
}

export interface CrawlRect {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  code: "FD6" | "CE7";
  depth: number;
  /** 다음에 받을 페이지 (1~3) */
  page: number;
}

export interface CrawlCursor {
  queue: CrawlRect[];
}

export interface CrawlListResponse {
  places: BasePlace[];
  cursor: CrawlCursor | null; // null이면 목록 수집 끝
  calls: number;
}

/** 앱에 저장되는 수집된 식당 (화면 표시 + 숨은 분류값) */
export interface CrawledPlace extends BasePlace {
  rating: number | null;
  ratingCount: number;
  reviewCount: number;
  blogReviewCount: number;
  menus: MenuItem[];
  tags: string[];
  snippets: string[];
  openHours: string[];
  attrs: Partial<Record<string, number>>;
  priceLevel: number | null;
  detailAt: number | null;
  detailFailed?: boolean;
  // 네이버 (폰에서 수집)
  naverId?: string | null;
  naverVisitorReviewCount?: number;
  naverBlogReviewCount?: number;
  naverKeywords?: string[];
  /** 규칙 기반 분류값 (AI 분류와 섞기 전) */
  ruleAttrs?: Partial<Record<string, number>>;
  /** AI 분류를 마친 시각 */
  aiAt?: number | null;
}

/** AI 분류 요청 한 곳 분량 */
export interface AiClassifyInput {
  id: string;
  name: string;
  category: string;
  priceLevel: number | null;
  menus: string[];
  tags: string[];
  reviews: string[];
  openHours: string[];
}

export interface CrawlDetailItem {
  id: string;
  ok: boolean;
  rating: number | null;
  ratingCount: number;
  reviewCount: number;
  blogReviewCount: number;
  menus: MenuItem[];
  tags: string[];
  snippets: string[];
  openHours: string[];
  attrs: Partial<Record<string, number>>;
  priceLevel: number | null;
}

/** 지역 수집 결과 파일 (앱 기기 저장 / 서버 야간 수집 결과 공통 형식) */
export interface RegionFile {
  version: number;
  region: Region;
  places: Record<string, CrawledPlace>;
  listCursor: CrawlCursor | null;
  listStarted: boolean;
  listDone: boolean;
  doneAt: number | null;
  /** 서버(야간 수집) 결과를 마지막으로 확인한 시각 */
  remoteCheckedAt?: number | null;
  /** 합친 서버 결과의 수집 시각 */
  remoteDoneAt?: number | null;
}
