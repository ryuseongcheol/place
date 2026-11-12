/**
 * 식당의 숨은 분류값(attrs) 계산.
 * 카테고리·가게명·메뉴·카카오 강점 태그·후기·영업시간·별점/리뷰 수를 보고
 * 화면에는 보이지 않는 0~1 점수를 매긴다. 주제(테마)는 이 분류값의 가중 합으로 정의된다.
 * 서버(실시간 추천)와 앱(지역 미리 수집) 양쪽에서 같은 코드를 쓴다. 외부 의존성 없음.
 */

export const ATTR_KEYS = [
  "solo", // 혼자 먹기 편함
  "group", // 단체·모임
  "date", // 데이트 분위기
  "quiet", // 조용함·대화
  "family", // 가족·어르신
  "kids", // 아이 동반
  "parking", // 주차
  "value", // 가성비
  "premium", // 고급·특별한 날
  "soup", // 국물
  "hangover", // 해장
  "spicy", // 매운맛
  "meat", // 고기
  "seafood", // 해산물
  "noodle", // 면
  "alcohol", // 술
  "cafe", // 카페
  "brunch", // 브런치·아침
  "dessert", // 디저트·빵
  "latenight", // 늦게까지·24시
  "rainy", // 비 오는 날(전·막걸리·칼국수)
  "healthy", // 가볍고 건강
  "view", // 뷰·테라스
  "waiting", // 웨이팅·줄
  "hiddenGem", // 숨은 맛집 (평점 높고 덜 알려짐)
  "hot", // 핫플 (리뷰 많음)
] as const;

export type AttrKey = (typeof ATTR_KEYS)[number];
export type Attrs = Partial<Record<AttrKey, number>>;

/** 사람이 읽는 이름 (AI 프롬프트·추천 이유에 사용) */
export const ATTR_LABELS: Record<AttrKey, string> = {
  solo: "혼자 먹기 편함",
  group: "단체·모임에 좋음",
  date: "데이트 분위기",
  quiet: "조용히 대화하기 좋음",
  family: "가족·어르신과 가기 좋음",
  kids: "아이와 함께 가기 좋음",
  parking: "주차 가능",
  value: "가성비 좋음",
  premium: "특별한 날·고급",
  soup: "국물 요리",
  hangover: "해장",
  spicy: "매운맛",
  meat: "고기",
  seafood: "해산물",
  noodle: "면 요리",
  alcohol: "술 한잔",
  cafe: "카페",
  brunch: "브런치·아침",
  dessert: "디저트·빵",
  latenight: "늦게까지 영업",
  rainy: "비 오는 날 생각남",
  healthy: "가볍고 건강함",
  view: "뷰·테라스",
  waiting: "웨이팅 있는 인기",
  hiddenGem: "아는 사람만 아는 곳",
  hot: "요즘 핫한 곳",
};

const DICT: Partial<Record<AttrKey, string[]>> = {
  solo: ["혼밥", "혼자", "1인", "바테이블", "바 좌석", "카운터석", "1인석", "라멘", "라면", "돈까스", "덮밥", "김밥", "국밥", "우동", "분식", "패스트푸드", "햄버거", "도시락", "백반"],
  group: ["단체", "회식", "모임", "룸", "넓", "대형", "연회", "단체석", "고깃집", "호프", "이자카야", "뷔페"],
  date: ["데이트", "분위기", "기념일", "인테리어", "감성", "와인", "파스타", "이탈리안", "프랑스", "스테이크", "비스트로", "오마카세", "다이닝", "코스", "레스토랑", "칵테일"],
  quiet: ["조용", "아늑", "차분", "프라이빗", "대화", "룸", "한정식", "다이닝"],
  family: ["가족", "부모님", "어르신", "한정식", "갈비", "샤브샤브", "오리", "장어", "상견례", "외식"],
  kids: ["아이", "유아", "키즈", "어린이", "아기의자", "놀이방", "유아의자"],
  parking: ["주차", "발렛"],
  value: ["가성비", "저렴", "싸", "푸짐", "양 많", "양많", "무한리필", "리필", "착한 가격", "기사식당", "한식뷔페", "백반", "분식", "김밥"],
  premium: ["오마카세", "코스", "파인다이닝", "다이닝", "한우", "특별한 날", "기념일", "호텔", "프리미엄", "고급", "장어", "참치"],
  soup: ["국밥", "국물", "탕", "찌개", "전골", "국수", "칼국수", "수제비", "쌀국수", "라멘", "우동", "짬뽕", "해장국", "곰탕", "설렁탕", "순대국", "감자탕", "샤브샤브", "육개장"],
  hangover: ["해장", "해장국", "콩나물", "북엇국", "황태", "선지", "뼈해장", "순대국", "국밥", "쌀국수", "짬뽕", "속풀", "속이 풀"],
  spicy: ["매운", "맵", "얼얼", "마라", "불맛", "떡볶이", "쭈꾸미", "주꾸미", "낙곱새", "닭발", "짬뽕", "김치찜", "닭갈비", "불닭", "매콤"],
  meat: ["고기", "삼겹", "갈비", "한우", "소고기", "돼지", "곱창", "막창", "대창", "스테이크", "양꼬치", "숯불", "목살", "육류", "정육"],
  seafood: ["회", "횟집", "해산물", "조개", "생선", "초밥", "스시", "해물", "아구", "대게", "굴", "새우", "장어", "참치"],
  noodle: ["면", "국수", "라멘", "우동", "파스타", "냉면", "칼국수", "쌀국수", "소바", "짜장", "짬뽕", "막국수"],
  alcohol: ["술집", "주점", "포차", "이자카야", "호프", "와인", "맥주", "막걸리", "하이볼", "칵테일", "소주", "안주", "펍", "바"],
  cafe: ["카페", "커피", "로스터리", "디저트카페"],
  brunch: ["브런치", "아침", "모닝", "베이글", "샌드위치", "에그", "토스트", "팬케이크"],
  dessert: ["디저트", "베이커리", "빵", "케이크", "마카롱", "도넛", "크로플", "아이스크림", "젤라또", "제과"],
  latenight: ["24시", "새벽", "심야", "늦게", "야식", "밤늦게", "24시간"],
  rainy: ["파전", "전집", "부침", "빈대떡", "막걸리", "칼국수", "수제비", "전골", "부대찌개", "어묵"],
  healthy: ["샐러드", "포케", "비건", "채식", "건강", "저칼로리", "다이어트", "생선구이", "보리밥", "쌈밥", "곤드레"],
  view: ["뷰", "전망", "루프탑", "테라스", "야경", "한강", "오션", "창가"],
  waiting: ["웨이팅", "줄 서", "줄서", "대기", "오픈런", "기다", "예약 필수"],
};

export interface ClassifyInput {
  name: string;
  category: string;
  menus?: Array<{ name: string; price: string | null }>;
  tags?: string[];
  snippets?: string[];
  openHours?: string[];
  rating?: number | null;
  ratingCount?: number;
  reviewCount?: number;
  blogReviewCount?: number;
}

export interface ClassifyResult {
  attrs: Attrs;
  /** 대표 메뉴 가격의 중앙값 (원) */
  priceLevel: number | null;
}

function countHits(text: string, words: string[]): number {
  let n = 0;
  for (const w of words) if (text.includes(w)) n++;
  return n;
}

function parsePrice(p: string | null): number | null {
  if (!p) return null;
  const m = p.replace(/,/g, "").match(/(\d{3,7})/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1000 && n <= 1_000_000 ? n : null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** 영업시간 문자열에서 자정 넘어 영업하는지 */
function opensLate(hours: string[]): boolean {
  const t = hours.join(" ");
  if (/24시간|24시/.test(t)) return true;
  // "~ 02:00", "- 01:30", "~24:00"
  return /[~\-–]\s*(0[0-5]|24):\d{2}/.test(t) || /(새벽|익일)\s*\d/.test(t);
}

export function classify(input: ClassifyInput): ClassifyResult {
  const menus = input.menus ?? [];
  const tags = input.tags ?? [];
  const snippets = (input.snippets ?? []).slice(0, 15);
  const category = input.category ?? "";
  const name = input.name ?? "";
  const menuText = menus.map((m) => m.name).join(" ");
  const tagText = tags.join(" ");
  const reviewText = snippets.join(" ");

  const attrs: Attrs = {};
  for (const key of ATTR_KEYS) {
    const words = DICT[key];
    if (!words) continue;
    // 카테고리가 가장 믿을 만하고, 그다음 가게명·강점 태그, 메뉴, 후기 순
    const hits =
      countHits(category, words) * 2 +
      countHits(name, words) * 1.5 +
      countHits(tagText, words) * 1.5 +
      Math.min(3, countHits(menuText, words)) * 0.8 +
      Math.min(4, countHits(reviewText, words)) * 0.7;
    if (hits > 0) attrs[key] = Math.min(1, hits / 3);
  }

  // 가격대
  const prices = menus.map((m) => parsePrice(m.price)).filter((n): n is number => n !== null);
  const priceLevel = median(prices.slice(0, 12));
  if (priceLevel !== null) {
    if (priceLevel <= 9000) attrs.value = Math.max(attrs.value ?? 0, 0.8);
    else if (priceLevel <= 12000) attrs.value = Math.max(attrs.value ?? 0, 0.5);
    if (priceLevel >= 50000) attrs.premium = Math.max(attrs.premium ?? 0, 1);
    else if (priceLevel >= 30000) attrs.premium = Math.max(attrs.premium ?? 0, 0.7);
    if (priceLevel >= 25000) attrs.value = Math.max(0, (attrs.value ?? 0) - 0.5);
  }

  // 영업시간
  if (input.openHours?.length && opensLate(input.openHours)) attrs.latenight = Math.max(attrs.latenight ?? 0, 0.9);

  // 카테고리로 확실한 것
  if (/카페|커피/.test(category)) attrs.cafe = Math.max(attrs.cafe ?? 0, 1);
  if (/술집|주점|포장마차|호프|이자카야|와인바|칵테일/.test(category)) attrs.alcohol = Math.max(attrs.alcohol ?? 0, 1);

  // 평판 기반: 숨은 맛집 / 핫플
  const rating = input.rating ?? null;
  const rc = input.ratingCount ?? 0;
  const volume = (input.reviewCount ?? 0) + (input.blogReviewCount ?? 0) * 0.5;
  if (rating !== null && rating >= 4.2 && rc >= 5 && volume < 150) {
    attrs.hiddenGem = Math.min(1, (rating - 4.0) / 0.8) * (volume < 60 ? 1 : 0.6);
  }
  if (volume >= 150) attrs.hot = Math.min(1, Math.log10(volume) / 3);
  if (attrs.waiting) attrs.hot = Math.max(attrs.hot ?? 0, attrs.waiting * 0.8);

  // 정리: 0.05 미만 버리고 소수 둘째 자리
  for (const k of Object.keys(attrs) as AttrKey[]) {
    const v = attrs[k]!;
    if (v < 0.05) delete attrs[k];
    else attrs[k] = Math.round(v * 100) / 100;
  }
  return { attrs, priceLevel };
}

/**
 * 분류값과 주제 가중치로 적합도(0~100) 계산.
 * 가중치가 음수면 그 성질이 있을수록 감점 (예: 조용한 곳 ← 술집 감점).
 */
export function attrFit(attrs: Attrs | undefined | null, weights: Partial<Record<AttrKey, number>>): number {
  if (!attrs) return 0;
  let pos = 0;
  let max = 0;
  let neg = 0;
  for (const [k, w] of Object.entries(weights) as Array<[AttrKey, number]>) {
    const v = attrs[k] ?? 0;
    if (w > 0) {
      pos += w * v;
      max += w;
    } else neg += -w * v;
  }
  if (max === 0) return 0;
  // 가장 큰 가중치의 성질 하나만 강하게 맞아도 어느 정도 점수가 나오도록 완만하게
  const raw = pos / max;
  const score = Math.sqrt(Math.max(0, raw)) - neg * 0.6;
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

/** 적합도에 가장 많이 기여한 분류값 이름 (추천 이유용) */
export function topReasons(attrs: Attrs | undefined | null, weights: Partial<Record<AttrKey, number>>, n = 2): string[] {
  if (!attrs) return [];
  return (Object.entries(weights) as Array<[AttrKey, number]>)
    .filter(([, w]) => w > 0)
    .map(([k, w]) => [k, w * (attrs[k] ?? 0)] as const)
    .filter(([, s]) => s >= 0.2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => ATTR_LABELS[k]);
}
