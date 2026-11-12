/**
 * 카카오 카테고리("음식점 > 한식 > 국밥") → 지도 마커 아이콘.
 * glyph: 평면 픽토그램 (Material Community Icons 이름, 흰색으로 그림), color: 원 배경색, emoji: 글자 아이콘이 필요할 때
 * 가장 구체적인 단계부터 보고, 위에서부터 먼저 맞는 규칙을 쓴다.
 */
type Rule = [RegExp, string, string, string];

const RULES: Rule[] = [
  // [패턴, 픽토그램, 배경색, 이모지]
  [/커피|카페|로스터리|티하우스|찻집/, "coffee", "#8D6E63", "☕"],
  [/베이커리|제과|빵|도넛|베이글/, "food-croissant", "#C08A4B", "🥐"],
  [/아이스크림|젤라또|빙수/, "ice-cream", "#EC4899", "🍨"],
  [/디저트|케이크|마카롱|와플|쿠키/, "cake-variant", "#E1477E", "🍰"],
  [/치킨|닭강정/, "food-drumstick", "#F59E0B", "🍗"],
  [/피자/, "pizza", "#EF4444", "🍕"],
  [/햄버거|버거|패스트푸드|샌드위치|토스트/, "hamburger", "#F97316", "🍔"],
  [/칵테일|위스키|바$|펍/, "glass-cocktail", "#7C3AED", "🍸"],
  [/와인/, "glass-wine", "#7E22CE", "🍷"],
  [/술집|주점|호프|포장마차|포차|이자카야|맥주|막걸리|전집/, "glass-mug-variant", "#CA8A04", "🍺"],
  [/초밥|스시|회$|횟집|오마카세|사시미|참치/, "fish", "#0EA5E9", "🍣"],
  [/라멘|라면|우동|소바/, "noodles", "#E11D48", "🍜"],
  [/돈까스|돈가스|카츠|덮밥|일식|일본/, "food-takeout-box", "#DB2777", "🍱"],
  [/마라|양꼬치|훠궈|중식|중국|짬뽕|짜장|딤섬|만두/, "soy-sauce", "#DC2626", "🥟"],
  [/스테이크|립/, "food-steak", "#B45309", "🥩"],
  [/파스타|이탈리/, "pasta", "#EA580C", "🍝"],
  [/멕시|타코|부리또/, "taco", "#F59E0B", "🌮"],
  [/양식|프랑스|스페인|비스트로|레스토랑|브런치/, "silverware-variant", "#EA580C", "🍽️"],
  [/베트남|쌀국수|태국|인도|아시아|커리|카레/, "bowl-mix", "#D97706", "🍛"],
  [/고기|육류|삼겹|갈비|곱창|막창|대창|정육|숯불|구이|족발|보쌈|오리/, "grill", "#B91C1C", "🥩"],
  [/해물|해산물|생선|조개|게$|대게|아구|장어|굴|낙지|쭈꾸미|주꾸미|오징어/, "fish", "#0284C7", "🐟"],
  [/분식|떡볶이|김밥|순대|튀김|어묵/, "chili-hot", "#F43F5E", "🍢"],
  [/국밥|해장국|탕$|찌개|전골|설렁탕|곰탕|순대국|감자탕|국$/, "pot-steam", "#B45309", "🍲"],
  [/국수|칼국수|냉면|면$|수제비|막국수/, "noodles", "#C2410C", "🍜"],
  [/샐러드|비건|채식|포케|건강/, "leaf", "#16A34A", "🥗"],
  [/뷔페/, "food-fork-drink", "#6B7280", "🍽️"],
  [/한정식|백반|한식|비빔밥|죽|도시락/, "rice", "#65A30D", "🍚"],
];

export interface CategoryIcon {
  glyph: string;
  color: string;
  emoji: string;
}

export function categoryIcon(category: string, name = ""): CategoryIcon {
  // "카페 > 디저트카페 > 베이커리" → 베이커리. 맨 앞 "음식점"은 제외. 각 단계 안의 쉼표(초밥,롤)도 나눠 본다
  const levels = category
    .split(">")
    .map((t) => t.trim())
    .slice(1)
    .reverse()
    .flatMap((t) => [t, ...t.split(",").map((x) => x.trim())]);
  for (const text of [...levels, name]) {
    for (const [re, glyph, color, emoji] of RULES) if (re.test(text)) return { glyph, color, emoji };
  }
  return { glyph: "silverware-fork-knife", color: "#4B5563", emoji: "🍽️" };
}
