import type { BasePlace, KakaoReviewInfo, LatLng, NaverReviewInfo, PlaceDetail } from "./types";
import { haversine } from "./util";

/** 키 없이 UI를 개발/시연하기 위한 가짜 데이터. 사용자 위치 주변에 흩뿌린다. */
const SAMPLES: Array<{ name: string; category: string; rating: number; n: number; nv: number; snippets: string[]; tags: string[] }> = [
  { name: "진국집 순대국", category: "음식점 > 한식 > 국밥", rating: 4.4, n: 182, nv: 2310, snippets: ["국물이 진하고 혼밥하기 편해요", "아침 해장으로 최고"], tags: ["혼밥", "해장", "가성비"] },
  { name: "멘야하나", category: "음식점 > 일식 > 일본식라면", rating: 4.6, n: 95, nv: 1840, snippets: ["바 좌석이라 혼자 오기 좋아요", "돈코츠 국물 진함"], tags: ["1인석", "웨이팅"] },
  { name: "트라토리아 루체", category: "음식점 > 양식 > 이탈리안", rating: 4.5, n: 64, nv: 980, snippets: ["조명이 예뻐서 데이트로 좋아요", "트러플 파스타 추천"], tags: ["분위기", "데이트", "와인"] },
  { name: "숯불명가 한우촌", category: "음식점 > 한식 > 육류,고기", rating: 4.2, n: 141, nv: 3120, snippets: ["단체 룸이 있어 회식하기 좋아요", "주차 가능"], tags: ["단체석", "룸", "주차"] },
  { name: "할매칼국수", category: "음식점 > 한식 > 칼국수", rating: 4.3, n: 210, nv: 4100, snippets: ["비 오는 날 생각나는 맛", "김치가 맛있어요"], tags: ["칼국수", "가성비"] },
  { name: "마라공방", category: "음식점 > 중식 > 마라탕", rating: 4.0, n: 77, nv: 1520, snippets: ["맵기 조절 가능, 얼얼해요"], tags: ["매운맛"] },
  { name: "르방 베이커리", category: "음식점 > 카페 > 베이커리", rating: 4.7, n: 38, nv: 860, snippets: ["크루아상이 바삭해요", "브런치 세트 괜찮아요"], tags: ["브런치", "빵"] },
  { name: "골목포차", category: "음식점 > 술집 > 포장마차", rating: 3.9, n: 52, nv: 640, snippets: ["새벽까지 해서 야식으로 좋아요"], tags: ["야식", "늦게까지"] },
  { name: "기와 한정식", category: "음식점 > 한식 > 한정식", rating: 4.5, n: 48, nv: 720, snippets: ["부모님 모시고 가기 좋아요", "룸 예약 가능"], tags: ["가족", "주차"] },
  { name: "엄마손 백반", category: "음식점 > 한식 > 한식뷔페", rating: 4.1, n: 120, nv: 1900, snippets: ["8천원에 반찬 무한리필"], tags: ["가성비", "혼밥"] },
  { name: "교동 짬뽕", category: "음식점 > 중식 > 중국요리", rating: 3.8, n: 260, nv: 5200, snippets: ["불맛 짬뽕, 해장으로 딱"], tags: ["해장", "매운맛"] },
  { name: "스시 하루", category: "음식점 > 일식 > 초밥,롤", rating: 4.8, n: 12, nv: 210, snippets: ["오마카세 가성비 좋음"], tags: ["오마카세", "데이트"] },
  { name: "옛날 콩나물국밥", category: "음식점 > 한식 > 국밥", rating: 4.2, n: 98, nv: 1650, snippets: ["새벽까지 해서 해장하기 좋아요", "수란이 맛있어요"], tags: ["해장", "24시"] },
  { name: "포베트남 쌀국수", category: "음식점 > 아시아음식 > 베트남음식", rating: 4.1, n: 66, nv: 1210, snippets: ["국물이 깔끔해서 해장으로 좋아요"], tags: ["해장", "쌀국수"] },
  { name: "원조 감자탕", category: "음식점 > 한식 > 감자탕", rating: 4.0, n: 143, nv: 2780, snippets: ["뼈해장국 푸짐해요", "24시간 영업"], tags: ["해장", "24시", "푸짐"] },
  { name: "카츠공방", category: "음식점 > 일식 > 돈까스,우동", rating: 4.4, n: 87, nv: 1430, snippets: ["혼자 와도 편한 바 좌석"], tags: ["혼밥", "돈까스"] },
  { name: "덮밥집 오늘", category: "음식점 > 일식 > 덮밥", rating: 4.2, n: 54, nv: 760, snippets: ["회전 빨라서 점심 혼밥 최고"], tags: ["혼밥", "덮밥"] },
  { name: "고메 스테이크하우스", category: "음식점 > 양식 > 스테이크,립", rating: 4.6, n: 41, nv: 690, snippets: ["기념일에 가기 좋아요", "분위기 최고"], tags: ["데이트", "분위기"] },
  { name: "비스트로 메종", category: "음식점 > 양식 > 프랑스음식", rating: 4.5, n: 29, nv: 430, snippets: ["와인 리스트가 좋아요"], tags: ["데이트", "와인"] },
  { name: "황금 삼겹살", category: "음식점 > 한식 > 육류,고기 > 삼겹살", rating: 4.3, n: 176, nv: 3890, snippets: ["단체석 넓어요", "회식 장소로 딱"], tags: ["회식", "단체석"] },
  { name: "이자카야 하나비", category: "음식점 > 술집 > 일본식주점", rating: 4.2, n: 63, nv: 980, snippets: ["룸이 있어 회식하기 좋아요"], tags: ["회식", "룸"] },
  { name: "동네 분식", category: "음식점 > 분식", rating: 4.0, n: 89, nv: 1340, snippets: ["떡볶이 3천원, 가성비 최고"], tags: ["가성비", "분식"] },
  { name: "기사님 식당", category: "음식점 > 한식 > 기사식당", rating: 4.1, n: 112, nv: 2010, snippets: ["양 많고 저렴해요"], tags: ["가성비", "푸짐"] },
  { name: "브런치 하우스", category: "음식점 > 카페 > 브런치", rating: 4.4, n: 58, nv: 1120, snippets: ["에그베네딕트 맛있어요"], tags: ["브런치"] },
  { name: "전집 막걸리", category: "음식점 > 술집 > 전,부침개", rating: 4.3, n: 77, nv: 1450, snippets: ["비 오는 날 웨이팅 있어요", "모둠전 추천"], tags: ["전", "막걸리"] },
  { name: "의정부 부대찌개", category: "음식점 > 한식 > 찌개,전골", rating: 4.0, n: 95, nv: 1730, snippets: ["라면사리 무한"], tags: ["부대찌개", "가성비"] },
  { name: "왕족발 보쌈", category: "음식점 > 한식 > 족발,보쌈", rating: 4.2, n: 132, nv: 2560, snippets: ["새벽 2시까지 해요"], tags: ["야식", "족발"] },
  { name: "바삭 치킨", category: "음식점 > 치킨", rating: 4.1, n: 71, nv: 1180, snippets: ["야식으로 시켜먹기 좋아요"], tags: ["야식", "치킨"] },
  { name: "한우 샤브샤브", category: "음식점 > 한식 > 샤브샤브", rating: 4.3, n: 49, nv: 870, snippets: ["아이들과 가기 좋아요", "주차 편해요"], tags: ["가족", "주차"] },
  { name: "불타는 쭈꾸미", category: "음식점 > 한식 > 해물,생선 > 쭈꾸미", rating: 4.2, n: 83, nv: 1610, snippets: ["매운맛 단계 선택 가능", "스트레스 풀려요"], tags: ["매운맛"] },
];

export function mockPlaces(loc: LatLng, keywords: string[]): BasePlace[] {
  const all = SAMPLES.map((s, i) => {
    const angle = (i / SAMPLES.length) * Math.PI * 2;
    const r = 120 + ((i * 137) % 700);
    const lat = loc.lat + (r * Math.sin(angle)) / 111000;
    const lng = loc.lng + (r * Math.cos(angle)) / (111000 * Math.cos((loc.lat * Math.PI) / 180));
    const text = `${s.name} ${s.category} ${s.tags.join(" ")} ${s.snippets.join(" ")}`;
    const matched = keywords.filter((k) => k.split(/\s+/).some((w) => text.includes(w) || s.tags.some((t) => w.includes(t))));
    return {
      id: `mock-${i}`,
      name: s.name,
      category: s.category,
      address: "(예시 주소)",
      roadAddress: "(예시 도로명 주소)",
      phone: "",
      lat,
      lng,
      distance: Math.round(haversine(loc, { lat, lng })),
      kakaoUrl: `https://map.kakao.com/?q=${encodeURIComponent(s.name)}`,
      searchRank: matched.length ? i % 4 : 8 + i,
      matchedKeywords: matched.length ? matched : [keywords[0] ?? "맛집"],
    };
  });
  // 검색어에 걸린 곳을 앞에 두고 나머지도 함께 돌려준다 (점수에서 관련도가 낮게 매겨짐)
  return all.sort((a, b) => a.searchRank - b.searchRank);
}

export function mockKakao(id: string): KakaoReviewInfo | null {
  const s = SAMPLES[Number(id.replace("mock-", ""))];
  if (!s) return null;
  return { rating: s.rating, ratingCount: s.n, reviewCount: s.n, blogReviewCount: Math.round(s.n * 1.5), snippets: s.snippets, tags: s.tags };
}

export function mockNaver(id: string, name: string): NaverReviewInfo | null {
  const s = SAMPLES[Number(id.replace("mock-", ""))];
  if (!s) return null;
  return {
    naverId: null,
    visitorReviewCount: s.nv,
    blogReviewCount: Math.round(s.nv * 0.4),
    rating: null,
    keywords: s.tags.map((t) => `${t} 좋아요`),
    naverUrl: `https://map.naver.com/p/search/${encodeURIComponent(name)}`,
  };
}

const MOCK_MENUS: Record<string, Array<[string, number]>> = {
  국밥: [["순대국", 10000], ["특순대국", 12000], ["모듬순대", 15000]],
  라면: [["돈코츠 라멘", 11000], ["매운 라멘", 12000], ["교자", 6000]],
  default: [["대표 메뉴", 12000], ["사이드 메뉴", 7000]],
};

export function mockDetail(id: string, name: string): PlaceDetail {
  const s = SAMPLES[Number(id.replace("mock-", ""))];
  const key = s ? Object.keys(MOCK_MENUS).find((k) => s.category.includes(k)) : undefined;
  const menus = (MOCK_MENUS[key ?? "default"] ?? MOCK_MENUS.default).map(([n, p]) => ({ name: n, price: `${p.toLocaleString("ko-KR")}원`, image: null }));
  const q = encodeURIComponent(name);
  return {
    id,
    photos: [1, 2, 3, 4].map((i) => `https://picsum.photos/seed/${id}-${i}/600/400`),
    photoSource: "kakao",
    menus,
    openHours: ["매일 11:00 ~ 22:00", "브레이크타임 15:00 ~ 17:00"],
    homepage: null,
    kakaoReviews: (s?.snippets ?? ["맛있어요"]).map((t, i) => ({ text: t, rating: 5 - (i % 2), date: "2026.10.0" + (i + 1), author: `리뷰어${i + 1}`, photos: [] })),
    blogReviews: [1, 2, 3].map((i) => ({
      title: `${name} 다녀온 후기 #${i}`,
      snippet: "예시 블로그 리뷰입니다. 실제 키를 넣으면 네이버 블로그 검색 결과가 나와요.",
      url: `https://m.search.naver.com/search.naver?where=m_blog&query=${q}`,
      blogger: `블로거${i}`,
      date: `2026.09.1${i}`,
      thumbnail: `https://picsum.photos/seed/${id}-blog${i}/200/200`,
      source: "naver" as const,
    })),
    blogReviewTotal: 128,
    links: {
      kakaoPlace: `https://m.map.kakao.com/actions/searchView?q=${q}`,
      kakaoReviews: `https://m.map.kakao.com/actions/searchView?q=${q}`,
      naverPlace: `https://m.map.naver.com/search2/search.naver?query=${q}`,
      naverVisitorReviews: `https://m.search.naver.com/search.naver?query=${q}`,
      naverBlogReviews: `https://m.search.naver.com/search.naver?where=m_blog&query=${q}`,
    },
    sources: { kakaoDetail: "mock", naverBlog: "mock", naverImage: "mock" },
  };
}
