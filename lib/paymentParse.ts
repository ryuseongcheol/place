/**
 * 결제 알림 문구 해석: 카드사·네이버페이·카카오페이·토스 푸시 알림에서 금액·가맹점·취소 여부를 뽑는다.
 * 알림 문구는 회사마다 다르고 바뀔 수 있어서, 여러 형태를 순서대로 시도한다.
 */
export interface ParsedPayment {
  amount: number;
  merchant: string | null;
  canceled: boolean;
  source: string;
}

const SOURCE_BY_PACKAGE: Record<string, string> = {
  "com.kakaopay.app": "카카오페이",
  "com.kakao.talk": "카카오페이",
  "com.nhn.android.search": "네이버페이",
  "com.naverfin.payapp": "네이버페이",
  "viva.republica.toss": "토스",
  "com.shcard.smartpay": "신한카드",
  "com.shinhancard.smartshinhan": "신한카드",
  "com.kbcard.cxh.appcard": "KB국민카드",
  "com.kbstar.kbbank": "KB국민",
  "kr.co.samsungcard.mpocket": "삼성카드",
  "com.hyundaicard.appcard": "현대카드",
  "com.lcacApp": "롯데카드",
  "com.lottecard.mobilecard": "롯데카드",
  "com.wooricard.smartapp": "우리카드",
  "com.hanaskcard.paycla": "하나카드",
  "com.hanacard.app": "하나카드",
  "com.bccard.bcmobile": "BC카드",
  "nh.smart.nhallonepay": "NH농협카드",
  "com.nhcard.nhallonepay": "NH농협카드",
  "com.ibk.ibkcard": "IBK카드",
  "com.citibank.mobile.kr": "씨티카드",
  "com.payco.app": "페이코",
};

const SOURCE_WORDS = ["네이버페이", "카카오페이", "토스", "페이코", "신한", "KB국민", "국민", "삼성", "현대", "롯데", "우리", "하나", "BC", "비씨", "농협", "NH", "IBK", "기업", "씨티"];

function detectSource(pkg: string, title: string, text: string): string {
  if (SOURCE_BY_PACKAGE[pkg]) return SOURCE_BY_PACKAGE[pkg];
  const t = `${title} ${text}`;
  const w = SOURCE_WORDS.find((s) => t.includes(s));
  if (!w) return "카드";
  return /페이|토스/.test(w) ? w : `${w.replace(/^비씨$/, "BC")}카드`;
}

const AMOUNT_RE = /([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,8})\s*원/g;
/** 금액 앞에 이런 말이 붙으면 결제 금액이 아니다 */
const NOT_PAYMENT_AMOUNT = /(누적|잔액|한도|포인트|적립|할인|캐시백|남은|사용가능|이용가능)\s*:?\s*$/;
/** 가맹점이 될 수 없는 줄 */
const NOT_MERCHANT = /원|승인|결제|누적|잔액|일시불|할부|체크|카드|님|\*|^\d|사용$|완료|알림|확인|취소|페이$|^토스$/;

/** 결제가 끝났다는 표현 */
const PAID = /승인|결제\s*(가|이)?\s*(완료|되었|됐|했|하였|금액|내역)|결제\s*$|결제\s*\n|원\s*(결제|사용|승인)|사용\s*(했|하셨|되었|완료|금액)|일시불|할부|체크카드|출금/m;
/** 광고·안내 문구 */
const AD = /결제\s*하면|결제\s*시|하시면|이벤트|쿠폰\s*(지급|발급|도착)|혜택|광고|\(광고\)|프로모션|추천해요/;

function pickAmount(text: string): number | null {
  for (const m of text.matchAll(AMOUNT_RE)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 8), m.index ?? 0);
    if (NOT_PAYMENT_AMOUNT.test(before)) continue;
    const n = Number(m[1].replace(/,/g, ""));
    if (n >= 100 && n <= 10_000_000) return n;
  }
  return null;
}

function cleanMerchant(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s
    .replace(/[\[\]【】「」<>"']/g, " ")
    .replace(/(에서|으로|로)?\s*(결제|사용|승인)(했어요|되었습니다|완료|됨|하셨습니다)?.*$/, "")
    .replace(/^\s*[|:·\-–]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!v || v.length < 2 || v.length > 40 || NOT_MERCHANT.test(v)) return null;
  return v;
}

export function parsePaymentNotification(n: { package: string; title: string; text: string; sub?: string }): ParsedPayment | null {
  const title = (n.title ?? "").trim();
  const text = (n.text ?? "").replace(/\r/g, "").trim();
  const all = `${title}\n${text}`;
  // 실제 결제가 일어났다는 표현이 있어야 한다 ("결제하면 할인" 같은 광고는 제외)
  if (!PAID.test(all) || AD.test(all)) return null;
  const amount = pickAmount(all);
  if (amount === null) return null;
  const canceled = /취소/.test(all) && !/취소\s*(가능|하려면)/.test(all);

  let merchant: string | null = null;
  // 1) "OO에서 12,000원 결제" (네이버페이·토스·카카오페이)
  merchant ??= cleanMerchant(all.match(/(?:^|\n|\]|\s)([^\n\]]{2,40}?)에서\s*[0-9,]+\s*원/)?.[1]);
  // 2) "결제 완료 | OO", "OO 12,000원 결제" (카카오페이)
  merchant ??= cleanMerchant(all.match(/결제\s*완료\s*[|:·]\s*([^\n]+)/)?.[1]);
  // 3) 카드사: "... 12,000원 일시불 11/13 12:30 OO 누적 ..." → 날짜·시각 다음이 가맹점
  merchant ??= cleanMerchant(all.match(/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s+([^\n]+?)(?:\s+누적|\s+잔액|\s+사용가능|$)/m)?.[1]);
  // 3-2) 체크카드: "... 8,000원 사용 OO 잔액 ..."
  merchant ??= cleanMerchant(all.match(/[0-9,]+\s*원\s*(?:사용|승인|결제)\s+([^\n]+?)(?:\s+누적|\s+잔액|\s+사용가능|$)/m)?.[1]);
  // 4) "[OO] 12,000원 결제"
  merchant ??= cleanMerchant(all.match(/^\s*\[?([^\]\n]{2,30})\]?\s*\n?\s*[0-9,]+\s*원\s*(결제|사용|승인)/m)?.[1]);
  // 5) 줄 단위: 금액·카드·이름 줄이 아닌 마지막 줄
  if (!merchant) {
    const lines = text.split(/\n|\s{2,}/).map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0 && !merchant; i--) merchant = cleanMerchant(lines[i]);
  }
  return { amount, merchant, canceled, source: detectSource(n.package, title, text) };
}
