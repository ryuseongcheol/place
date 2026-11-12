import type { ThemeQuery } from "./types";

export interface ThemePreset {
  id: string;
  label: string;
  emoji: string;
  description: string; // AI에게 넘길 설명
  query: Omit<ThemeQuery, "summary">;
}

const W = (rating: number, popularity: number, relevance: number, distance: number) => ({
  rating,
  popularity,
  relevance,
  distance,
});

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "solo",
    label: "혼밥",
    emoji: "🍜",
    description: "혼자 편하게 먹기 좋은 곳. 1인석·바 좌석, 회전 빠름, 1인분 주문 가능.",
    query: { keywords: ["혼밥", "국밥", "라멘", "돈까스", "덮밥", "김밥"], includeCafe: false, avoid: ["고기뷔페", "코스요리"], boost: ["혼밥", "1인", "바테이블", "혼자"], weights: W(0.35, 0.15, 0.25, 0.25) },
  },
  {
    id: "date",
    label: "데이트",
    emoji: "💕",
    description: "분위기 좋은 데이트 장소. 인테리어, 조용함, 양식/와인/오마카세 등.",
    query: { keywords: ["파스타", "와인바", "스테이크", "이탈리안", "오마카세", "비스트로"], includeCafe: false, avoid: ["기사식당", "분식"], boost: ["분위기", "인테리어", "데이트", "기념일", "조용"], weights: W(0.45, 0.2, 0.25, 0.1) },
  },
  {
    id: "group",
    label: "회식",
    emoji: "🍻",
    description: "단체 회식 장소. 단체석·룸, 고기/한식/중식, 주류.",
    query: { keywords: ["고깃집", "삼겹살", "한우", "중식당", "이자카야", "횟집"], includeCafe: false, avoid: ["카페", "디저트"], boost: ["단체", "룸", "회식", "넓", "주차"], weights: W(0.35, 0.3, 0.25, 0.1) },
  },
  {
    id: "hangover",
    label: "해장",
    emoji: "🥣",
    description: "해장하기 좋은 국물 요리. 국밥, 해장국, 쌀국수, 짬뽕.",
    query: { keywords: ["해장국", "국밥", "쌀국수", "짬뽕", "감자탕", "콩나물국밥"], includeCafe: false, avoid: ["카페", "디저트", "술집"], boost: ["해장", "국물", "시원", "24시"], weights: W(0.35, 0.2, 0.2, 0.25) },
  },
  {
    id: "value",
    label: "가성비",
    emoji: "💰",
    description: "저렴하면서 양 많고 맛있는 곳.",
    query: { keywords: ["백반", "분식", "국수", "김밥", "기사식당", "한식뷔페"], includeCafe: false, avoid: ["오마카세", "파인다이닝"], boost: ["가성비", "저렴", "양 많", "푸짐", "가격"], weights: W(0.3, 0.35, 0.2, 0.15) },
  },
  {
    id: "brunch",
    label: "브런치·카페",
    emoji: "🥐",
    description: "브런치, 베이커리, 디저트 카페.",
    query: { keywords: ["브런치", "베이커리", "디저트", "샌드위치", "카페"], includeCafe: true, avoid: ["술집", "고깃집"], boost: ["브런치", "빵", "디저트", "커피", "뷰"], weights: W(0.4, 0.25, 0.25, 0.1) },
  },
  {
    id: "rainy",
    label: "비 오는 날",
    emoji: "🌧️",
    description: "비 오는 날 생각나는 음식. 전, 막걸리, 칼국수, 수제비.",
    query: { keywords: ["파전", "칼국수", "수제비", "막걸리", "전집", "부대찌개"], includeCafe: false, avoid: ["냉면"], boost: ["전", "막걸리", "칼국수", "따뜻"], weights: W(0.35, 0.2, 0.25, 0.2) },
  },
  {
    id: "latenight",
    label: "야식",
    emoji: "🌙",
    description: "늦게까지 하는 야식 장소. 치킨, 족발, 포차.",
    query: { keywords: ["치킨", "족발", "보쌈", "포차", "곱창", "닭발"], includeCafe: false, avoid: ["브런치"], boost: ["24시", "새벽", "늦게", "야식"], weights: W(0.3, 0.25, 0.2, 0.25) },
  },
  {
    id: "family",
    label: "가족 모임",
    emoji: "👨‍👩‍👧",
    description: "아이·부모님과 가기 좋은 곳. 주차, 넓은 좌석, 한정식.",
    query: { keywords: ["한정식", "갈비", "샤브샤브", "오리고기", "중식당", "한식"], includeCafe: false, avoid: ["술집", "포차"], boost: ["주차", "아이", "가족", "룸", "넓"], weights: W(0.4, 0.25, 0.25, 0.1) },
  },
  {
    id: "spicy",
    label: "매운맛",
    emoji: "🌶️",
    description: "스트레스 풀리는 매운 음식. 마라탕, 쭈꾸미, 닭발, 떡볶이.",
    query: { keywords: ["마라탕", "쭈꾸미", "떡볶이", "닭발", "짬뽕", "낙곱새"], includeCafe: false, avoid: ["디저트"], boost: ["매운", "맵", "얼얼", "불맛"], weights: W(0.35, 0.25, 0.25, 0.15) },
  },
];

export const DEFAULT_WEIGHTS = W(0.4, 0.2, 0.2, 0.2);

export function getPreset(id: string | null | undefined): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}

/** AI 없이 프리셋 + 자유 입력을 검색 조건으로 바꾼다 */
export function heuristicQuery(preset: ThemePreset | undefined, text: string): ThemeQuery {
  const t = text.trim();
  if (!preset && !t) {
    return { keywords: ["맛집"], includeCafe: false, avoid: [], boost: [], summary: "주변 맛집", weights: DEFAULT_WEIGHTS };
  }
  if (!preset) {
    return {
      keywords: [t.slice(0, 30)],
      includeCafe: /카페|커피|디저트|빵|베이커리|브런치/.test(t),
      avoid: [],
      boost: t.split(/\s+/).filter((w) => w.length >= 2).slice(0, 6),
      summary: t,
      weights: DEFAULT_WEIGHTS,
    };
  }
  const q = preset.query;
  return {
    ...q,
    keywords: t ? [t.slice(0, 30), ...q.keywords].slice(0, 6) : q.keywords,
    boost: t ? [...t.split(/\s+/).filter((w) => w.length >= 2), ...q.boost].slice(0, 10) : q.boost,
    summary: t ? `${preset.label}: ${t}` : preset.label,
  };
}
