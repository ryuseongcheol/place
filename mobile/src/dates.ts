/** 날짜·금액 표시 (Intl 없이 직접 만들어서 기기마다 같게) */
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86400000);
  const k = dayKey(ts);
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`;
  const year = d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}년 ` : "";
  if (k === today) return `오늘 · ${base}`;
  if (k === yesterday) return `어제 · ${base}`;
  return year + base;
}

export function shortDate(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
}

export function timeLabel(ts: number) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function won(n: number) {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`;
}

/** 이번 달 1일 0시 */
export function monthStart(ts = Date.now()) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
