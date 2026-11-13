import { normalizeName } from "./util";

/**
 * 가게 이름·지점·동네 다루기 (검색 정확도).
 * "스타벅스 강남역점" → 브랜드 "스타벅스", 지점 "강남역"
 */
export function splitBranch(name: string): { brand: string; branch: string | null } {
  const m = name.trim().match(/^(.*\S)\s+(\S+?)점$/);
  if (m && m[2].length >= 1) return { brand: m[1], branch: m[2] };
  return { brand: name.trim(), branch: null };
}

/** "역삼1동" → "역삼", "성수동1가" → "성수" (블로그 본문에서 찾기 쉬운 형태) */
export function dongCore(dong: string | null | undefined): string {
  if (!dong) return "";
  return normalizeName(dong.replace(/[0-9·.]+(가)?동$|동[0-9]*가?$|[0-9]*가$/, ""));
}

/**
 * 블로그 글이 이 가게(이 지점) 얘기인지.
 * - 브랜드 이름(또는 첫 단어)이 있어야 하고
 * - 이름에 지점이 있으면 지점명이나 동네 이름도 함께 있어야 한다 (다른 지점 글 거르기)
 */
export function postMentionsPlace(text: string, name: string, dong?: string | null): boolean {
  const { brand, branch } = splitBranch(name);
  const n = normalizeName(text);
  const b = normalizeName(brand);
  const first = normalizeName(brand.split(/\s+/)[0] ?? "");
  const brandHit = (b.length > 0 && n.includes(b)) || (first.length >= 2 && n.includes(first));
  if (!brandHit) return false;
  if (!branch) return true;
  const br = normalizeName(branch);
  const dc = dongCore(dong);
  return (br.length >= 1 && n.includes(br)) || (dc.length >= 2 && n.includes(dc));
}

/** 두 가게 이름이 지점까지 같은 가게로 볼 수 있는지 (지점이 둘 다 있는데 다르면 다른 가게) */
export function sameBranch(a: string, b: string): boolean {
  const x = splitBranch(a);
  const y = splitBranch(b);
  if (x.branch && y.branch) return normalizeName(x.branch) === normalizeName(y.branch);
  return true;
}

/** 목록에 보여줄 짧은 위치: "역삼동 · 테헤란로 152" */
export function shortArea(p: { address?: string | null; roadAddress?: string | null }): string {
  const clean = (v?: string | null) => (v ?? "").replace(/\(.*?\)/g, "").trim();
  const dong = clean(p.address).split(/\s+/).find((t) => /(동|가|읍|면|리)$/.test(t) && !/^\d/.test(t)) ?? "";
  const road = clean(p.roadAddress).split(/\s+/).filter(Boolean).slice(-2).join(" ");
  return [dong, road].filter(Boolean).join(" · ");
}

/**
 * 같은 브랜드(체인·같은 이름) 여러 지점이 결과에 겹치면 순서상 첫 번째(=점수 높은)만 남기고
 * 남은 지점 수를 otherBranches 로 붙인다.
 */
export function dedupeBranches<T extends { id: string; name: string }>(list: T[]): Array<T & { otherBranches?: number }> {
  const kept = new Map<string, T & { otherBranches?: number }>();
  const order: string[] = [];
  for (const p of list) {
    const key = normalizeName(splitBranch(p.name).brand);
    const hit = kept.get(key);
    if (hit) hit.otherBranches = (hit.otherBranches ?? 0) + 1;
    else {
      kept.set(key, { ...p });
      order.push(key);
    }
  }
  return order.map((k) => kept.get(k)!);
}
