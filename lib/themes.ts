import type { AttrKey } from "./classify";
import type { ThemeQuery } from "./types";

/**
 * 추천 주제. 단어(국밥, 파스타) 대신 상황·기분으로 고르게 하고,
 * 각 주제는 숨은 분류값(attrs, lib/classify.ts)의 가중치로 정의한다.
 * - keywords: 실시간(내 주변) 검색 때 카카오에 넣을 검색어
 * - attrs: 분류값 가중치 (음수면 감점). 미리 수집한 지역 데이터는 이것만으로 순위를 낸다.
 * 주제를 바꾸려면 이 목록만 고치면 된다. (앱도 같은 파일을 쓴다)
 */
export interface ThemePreset {
  id: string;
  label: string;
  emoji: string;
  /** 한 줄 설명 (AI 해석·화면 부제) */
  description: string;
  keywords: string[];
  includeCafe: boolean;
  avoid: string[];
  attrs: Partial<Record<AttrKey, number>>;
  weights: ThemeQuery["weights"];
}

const W = (rating: number, popularity: number, relevance: number, distance: number) => ({ rating, popularity, relevance, distance });

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "solo",
    label: "혼자여도 편안한",
    emoji: "🍜",
    description: "눈치 안 보고 혼자 들어가 편하게 먹고 나올 수 있는 곳",
    keywords: ["국밥", "라멘", "돈까스", "덮밥", "우동", "김밥"],
    includeCafe: false,
    avoid: ["코스요리"],
    attrs: { solo: 1, value: 0.3, noodle: 0.2, soup: 0.2, group: -0.3, premium: -0.2 },
    weights: W(0.3, 0.15, 0.35, 0.2),
  },
  {
    id: "date",
    label: "설레는 데이트",
    emoji: "💕",
    description: "분위기 좋고 대화하기 좋은, 둘이 가기 좋은 곳",
    keywords: ["파스타", "와인바", "스테이크", "이탈리안", "오마카세", "비스트로"],
    includeCafe: false,
    avoid: ["기사식당"],
    attrs: { date: 1, quiet: 0.4, premium: 0.3, view: 0.3, dessert: 0.1, hangover: -0.3, group: -0.2 },
    weights: W(0.35, 0.15, 0.4, 0.1),
  },
  {
    id: "together",
    label: "왁자지껄 다 같이",
    emoji: "🍻",
    description: "여럿이 모여 시끌벅적하게 먹고 마시기 좋은 곳",
    keywords: ["고깃집", "삼겹살", "이자카야", "횟집", "중식당", "호프"],
    includeCafe: false,
    avoid: ["카페"],
    attrs: { group: 1, meat: 0.4, alcohol: 0.5, parking: 0.2, solo: -0.3, quiet: -0.2 },
    weights: W(0.3, 0.25, 0.35, 0.1),
  },
  {
    id: "comfort",
    label: "속 풀리는 한 그릇",
    emoji: "🥣",
    description: "뜨끈한 국물로 속이 풀리는 해장 한 그릇",
    keywords: ["해장국", "국밥", "쌀국수", "짬뽕", "감자탕", "콩나물국밥"],
    includeCafe: false,
    avoid: ["카페", "디저트"],
    attrs: { hangover: 1, soup: 0.8, latenight: 0.2, solo: 0.1 },
    weights: W(0.3, 0.2, 0.3, 0.2),
  },
  {
    id: "value",
    label: "지갑이 웃는 한 끼",
    emoji: "💰",
    description: "가격 부담 없이 배부르게 먹는 가성비 한 끼",
    keywords: ["백반", "분식", "국수", "김밥", "기사식당", "한식뷔페"],
    includeCafe: false,
    avoid: ["오마카세", "파인다이닝"],
    attrs: { value: 1, solo: 0.2, premium: -0.7 },
    weights: W(0.25, 0.3, 0.3, 0.15),
  },
  {
    id: "brunch",
    label: "느긋한 브런치",
    emoji: "🥐",
    description: "늦은 아침, 커피와 빵으로 여유롭게",
    keywords: ["브런치", "베이커리", "디저트", "샌드위치", "카페"],
    includeCafe: true,
    avoid: ["술집", "고깃집"],
    attrs: { brunch: 1, cafe: 0.6, dessert: 0.5, quiet: 0.2, view: 0.2, alcohol: -0.4 },
    weights: W(0.35, 0.2, 0.35, 0.1),
  },
  {
    id: "rainy",
    label: "비 오는 날 생각나는",
    emoji: "🌧️",
    description: "빗소리 들으며 전에 막걸리, 칼국수가 당길 때",
    keywords: ["파전", "칼국수", "수제비", "막걸리", "전집", "부대찌개"],
    includeCafe: false,
    avoid: [],
    attrs: { rainy: 1, soup: 0.4, alcohol: 0.3, noodle: 0.2 },
    weights: W(0.3, 0.2, 0.35, 0.15),
  },
  {
    id: "midnight",
    label: "잠 못 드는 밤",
    emoji: "🌙",
    description: "늦은 밤에도 문 열려 있는 야식·한잔",
    keywords: ["치킨", "족발", "보쌈", "포차", "곱창", "닭발"],
    includeCafe: false,
    avoid: ["브런치"],
    attrs: { latenight: 1, alcohol: 0.5, meat: 0.2, spicy: 0.1, brunch: -0.4 },
    weights: W(0.25, 0.2, 0.35, 0.2),
  },
  {
    id: "parents",
    label: "부모님 모시고",
    emoji: "👨‍👩‍👧",
    description: "어르신 입맛에 맞고 편하게 앉아 식사할 수 있는 곳",
    keywords: ["한정식", "갈비", "샤브샤브", "오리고기", "장어", "한식"],
    includeCafe: false,
    avoid: ["포장마차"],
    attrs: { family: 1, parking: 0.5, quiet: 0.3, premium: 0.2, kids: 0.2, alcohol: -0.4, spicy: -0.2 },
    weights: W(0.35, 0.25, 0.3, 0.1),
  },
  {
    id: "spicy",
    label: "땀나는 매운맛",
    emoji: "🌶️",
    description: "스트레스 날려버리는 얼얼하고 매운맛",
    keywords: ["마라탕", "쭈꾸미", "떡볶이", "닭발", "짬뽕", "낙곱새"],
    includeCafe: false,
    avoid: ["디저트"],
    attrs: { spicy: 1 },
    weights: W(0.3, 0.25, 0.3, 0.15),
  },
  {
    id: "special",
    label: "특별한 날 기분 내기",
    emoji: "✨",
    description: "기념일·축하 자리, 제대로 기분 내고 싶은 날",
    keywords: ["오마카세", "코스요리", "파인다이닝", "스테이크", "한우", "레스토랑"],
    includeCafe: false,
    avoid: ["분식", "기사식당"],
    attrs: { premium: 1, date: 0.5, view: 0.4, quiet: 0.3, value: -0.3 },
    weights: W(0.4, 0.15, 0.35, 0.1),
  },
  {
    id: "quiet",
    label: "조용히 대화하기 좋은",
    emoji: "🤫",
    description: "시끄럽지 않게 이야기 나누기 좋은 곳",
    keywords: ["한정식", "일식", "이탈리안", "다이닝", "비스트로", "카페"],
    includeCafe: true,
    avoid: ["포장마차", "호프"],
    attrs: { quiet: 1, date: 0.3, cafe: 0.2, group: -0.4, alcohol: -0.3, waiting: -0.2 },
    weights: W(0.35, 0.1, 0.4, 0.15),
  },
  {
    id: "gem",
    label: "아는 사람만 아는",
    emoji: "💎",
    description: "평점은 높은데 아직 덜 알려진 동네 숨은 맛집",
    keywords: ["맛집", "한식", "일식", "양식", "중식", "분식"],
    includeCafe: false,
    avoid: [],
    attrs: { hiddenGem: 1, hot: -0.5 },
    weights: W(0.45, 0.0, 0.4, 0.15),
  },
  {
    id: "hot",
    label: "줄 서서 먹는 핫플",
    emoji: "🔥",
    description: "다들 줄 서서 먹는 요즘 제일 핫한 곳",
    keywords: ["맛집", "한식", "일식", "양식", "디저트", "고깃집"],
    includeCafe: true,
    avoid: [],
    attrs: { hot: 1, waiting: 0.6 },
    weights: W(0.3, 0.4, 0.25, 0.05),
  },
  {
    id: "tv",
    label: "방송에 나온 맛집",
    emoji: "📺",
    description: "수요미식회·흑백요리사·먹을텐데 등 방송·유튜브·미쉐린에 소개된 곳",
    keywords: ["맛집", "한식", "일식", "양식", "중식", "고깃집"],
    includeCafe: true,
    avoid: [],
    attrs: { tvShow: 1, guide: 0.7, hot: 0.2 },
    weights: W(0.35, 0.25, 0.35, 0.05),
  },
  {
    id: "light",
    label: "가볍고 건강하게",
    emoji: "🥗",
    description: "속 편하고 가볍게, 건강한 한 끼",
    keywords: ["샐러드", "포케", "비건", "샤브샤브", "생선구이", "쌈밥"],
    includeCafe: false,
    avoid: [],
    attrs: { healthy: 1, seafood: 0.2, alcohol: -0.3, meat: -0.2 },
    weights: W(0.35, 0.15, 0.35, 0.15),
  },
  {
    id: "meat",
    label: "든든한 고기 한 판",
    emoji: "🥩",
    description: "지글지글 구워 먹는 든든한 고기",
    keywords: ["고깃집", "삼겹살", "갈비", "한우", "양꼬치", "곱창"],
    includeCafe: false,
    avoid: ["카페"],
    attrs: { meat: 1, group: 0.3, alcohol: 0.2 },
    weights: W(0.3, 0.25, 0.3, 0.15),
  },
];

export const DEFAULT_WEIGHTS = W(0.4, 0.2, 0.2, 0.2);

export function getPreset(id: string | null | undefined): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}

/** AI 없이 주제 + 자유 입력을 검색 조건으로 바꾼다 */
export function heuristicQuery(preset: ThemePreset | undefined, text: string): ThemeQuery {
  const t = text.trim();
  if (!preset && !t) {
    return { themeId: null, keywords: ["맛집"], includeCafe: false, avoid: [], boost: [], attrWeights: {}, summary: "주변 맛집", weights: DEFAULT_WEIGHTS };
  }
  if (!preset) {
    return {
      themeId: null,
      keywords: [t.slice(0, 30)],
      includeCafe: /카페|커피|디저트|빵|베이커리|브런치/.test(t),
      avoid: [],
      boost: t.split(/\s+/).filter((w) => w.length >= 2).slice(0, 6),
      attrWeights: {},
      summary: t,
      weights: DEFAULT_WEIGHTS,
    };
  }
  return {
    themeId: preset.id,
    keywords: t ? [t.slice(0, 30), ...preset.keywords].slice(0, 6) : preset.keywords,
    includeCafe: preset.includeCafe,
    avoid: preset.avoid,
    boost: t.split(/\s+/).filter((w) => w.length >= 2).slice(0, 6),
    attrWeights: preset.attrs,
    summary: t ? `${preset.label} · ${t}` : preset.label,
    weights: preset.weights,
  };
}
