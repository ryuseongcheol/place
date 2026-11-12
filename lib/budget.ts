/**
 * 요청 한 번에 쓸 수 있는 외부 호출(subrequest) 수.
 * Cloudflare Workers 무료 플랜은 요청당 50회로 제한되고, 넘으면 fetch가 실패한다.
 * 캐시에 있는 건 호출하지 않으므로 소모하지 않는다.
 * 유료 플랜이면 SUBREQUEST_BUDGET 환경변수로 늘린다 (예: 500).
 */
export class Budget {
  private left: number;
  constructor(total: number) {
    this.left = total;
  }
  get remaining() {
    return this.left;
  }
  /** n회 쓸 수 있으면 차감하고 true */
  take(n = 1): boolean {
    if (this.left < n) return false;
    this.left -= n;
    return true;
  }
}

export function requestBudget(): Budget {
  const n = Number(process.env.SUBREQUEST_BUDGET);
  return new Budget(Number.isFinite(n) && n > 0 ? n : 48);
}

/** 예산 크기에 맞춘 단계별 호출 계획 */
export function planFor(budget: number, keywordCount: number) {
  const large = budget > 120;
  return {
    /** 검색어당 카카오 검색 페이지 수 (페이지당 15곳) */
    kakaoPages: large ? 3 : keywordCount <= 3 ? 2 : 1,
    /** 네이버 지도 검색을 돌릴 검색어 수 */
    naverKeywordSearches: large ? keywordCount : Math.min(keywordCount, 3),
    /** 매칭 안 된 가게를 이름으로 개별 검색하는 최대 수 */
    naverIndividual: large ? 10 : 3,
    /** 리뷰(카카오 상세)를 조회할 최대 후보 수 */
    maxDetail: large ? 45 : 32,
  };
}
