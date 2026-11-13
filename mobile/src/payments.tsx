import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { ackPayments, getPendingPayments, type RawPaymentNotification } from "../modules/payment-notifications";
import { matchMerchants } from "./api";
import { snapOf, type PlaceSnap } from "./placeSnap";
import { nameSimilarity, parsePaymentNotification } from "./shared";

/**
 * 결제 기록 (내 타임라인의 "방문").
 * 1) 네이티브 알림 리스너가 결제 알림을 받는 순간 시각·위치와 함께 보관 (modules/payment-notifications)
 * 2) 앱이 켜지거나 백그라운드 작업이 돌 때 가져와서 문구를 해석 (lib/paymentParse.ts)
 * 3) 서버가 가맹점 이름을 결제 위치 근처 카카오 장소와 맞춘다 (/api/match/merchants)
 * 카드 알림 + 페이 알림이 같은 결제로 두 번 오면 하나로 합치고, 취소 알림이 오면 원래 결제를 취소로 표시한다.
 */
export type PaymentStatus = "pending" | "matched" | "notFood" | "unmatched";

export interface PaymentRecord {
  id: string;
  /** 결제 시각 */
  at: number;
  amount: number;
  /** 알림에 나온 가맹점 이름 (고칠 수 있음) */
  merchant: string | null;
  /** 신한카드 · 네이버페이 · 직접 입력 등 */
  sources: string[];
  canceled?: boolean;
  /** 결제 순간 휴대폰 위치 */
  lat?: number;
  lng?: number;
  status: PaymentStatus;
  place?: PlaceSnap;
  /** 음식점이 아닐 때 업종 */
  reason?: string;
  manual?: boolean;
  /** 타임라인에서 숨김 */
  hidden?: boolean;
  /** 알림 원문 (확인용, 기기 안에만) */
  raw?: string;
  tries?: number;
}

const KEY = "payments:v1";
const MAX_RECORDS = 3000;

let cache: PaymentRecord[] | null = null;
const listeners = new Set<(list: PaymentRecord[]) => void>();
let chain: Promise<unknown> = Promise.resolve();

async function load(): Promise<PaymentRecord[]> {
  if (cache) return cache;
  try {
    const v = await AsyncStorage.getItem(KEY);
    cache = v ? (JSON.parse(v) as PaymentRecord[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist(list: PaymentRecord[]) {
  const sorted = [...list].sort((a, b) => b.at - a.at).slice(0, MAX_RECORDS);
  cache = sorted;
  await AsyncStorage.setItem(KEY, JSON.stringify(sorted));
  for (const l of listeners) l(sorted);
}

/** 기록 변경은 한 줄로 세워서 처리 (동시에 고치면 덮어쓰지 않게) */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function mutate(fn: (list: PaymentRecord[]) => PaymentRecord[] | void) {
  return serial(async () => {
    const list = [...(await load())].map((r) => ({ ...r }));
    const out = fn(list) ?? list;
    await persist(out);
  });
}

const PAY_APPS = /페이|토스/;
const MIN = 60 * 1000;

/** 카드 알림과 페이 알림이 같은 결제인지 */
function sameMerchant(a: string | null, b: string | null) {
  if (!a || !b) return true;
  return nameSimilarity(a, b) >= 0.4;
}

function locFor(r: RawPaymentNotification, fallback: { lat: number; lng: number } | null | undefined) {
  // 결제 순간 기준 6시간 안에 잡힌 위치면 쓴다
  if (r.lat != null && r.lng != null && (!r.locAt || Math.abs(r.postedAt - r.locAt) < 6 * 60 * MIN)) return { lat: r.lat, lng: r.lng };
  // 결제 직후(2시간 안)에 앱을 열었으면 지금 위치가 가게 근처일 가능성이 높다
  if (fallback && Date.now() - r.postedAt < 2 * 60 * MIN) return fallback;
  return null;
}

/** 네이티브가 모아 둔 알림 → 기록 */
function ingest(list: PaymentRecord[], raws: RawPaymentNotification[], fallback?: { lat: number; lng: number } | null) {
  let added = 0;
  for (const r of [...raws].sort((a, b) => a.postedAt - b.postedAt)) {
    if (list.some((x) => x.id === r.key)) continue;
    const p = parsePaymentNotification({ package: r.package, title: r.title, text: r.text, sub: r.sub });
    if (!p) continue;
    if (p.canceled) {
      // 원래 결제(같은 금액, 30일 안)를 찾아 취소로 표시
      const orig = list
        .filter((x) => !x.canceled && x.amount === p.amount && x.at <= r.postedAt && r.postedAt - x.at < 30 * 24 * 60 * MIN && sameMerchant(x.merchant, p.merchant))
        .sort((a, b) => b.at - a.at)[0];
      if (orig) orig.canceled = true;
      continue;
    }
    // 같은 결제가 카드사·페이 앱에서 각각 오거나, 같은 앱이 알림을 다시 띄운 경우
    const dup = list.find(
      (x) =>
        !x.manual &&
        x.amount === p.amount &&
        Math.abs(x.at - r.postedAt) < 5 * MIN &&
        (x.sources.includes(p.source)
          ? sameMerchant(x.merchant, p.merchant) && Math.abs(x.at - r.postedAt) < 2 * MIN
          : sameMerchant(x.merchant, p.merchant) || x.sources.some((s) => PAY_APPS.test(s)) !== PAY_APPS.test(p.source)),
    );
    const loc = locFor(r, fallback);
    if (dup) {
      if (!dup.sources.includes(p.source)) dup.sources = [...dup.sources, p.source];
      // 페이 앱 쪽 가게 이름이 보통 더 정확하다
      if (p.merchant && (!dup.merchant || (dup.status !== "matched" && PAY_APPS.test(p.source)))) {
        dup.merchant = p.merchant;
        if (dup.status !== "matched") {
          dup.status = "pending";
          dup.tries = 0;
        }
      }
      if (dup.lat == null && loc) Object.assign(dup, loc);
      continue;
    }
    list.push({
      id: r.key,
      at: r.postedAt,
      amount: p.amount,
      merchant: p.merchant,
      sources: [p.source],
      ...(loc ?? {}),
      status: p.merchant ? "pending" : "unmatched",
      raw: `${r.title}\n${r.text}`.slice(0, 300),
    });
    added++;
  }
  return added;
}

/** 가맹점 → 가게 맞추기 (아직 못 맞춘 것만, 한 번에 최대 40건) */
async function matchPending(list: PaymentRecord[]) {
  const todo = list.filter((x) => x.status === "pending" && x.merchant && (x.tries ?? 0) < 3).slice(0, 40);
  let matched = 0;
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    let res;
    try {
      res = await matchMerchants(batch.map((x) => ({ id: x.id, merchant: x.merchant!, lat: x.lat ?? null, lng: x.lng ?? null })));
    } catch {
      break; // 서버 연결 실패: 다음에 다시
    }
    const byId = new Map(res.results.map((r) => [r.id, r.result]));
    for (const x of batch) {
      const r = byId.get(x.id);
      if (!r) continue; // 서버 예산이 모자라 못 한 것: 다음에
      x.tries = (x.tries ?? 0) + 1;
      if (r.status === "matched") {
        x.status = "matched";
        x.place = snapOf(r.place);
        matched++;
      } else if (r.status === "notFood") {
        x.status = "notFood";
        x.reason = r.reason;
        x.place = r.place ? snapOf(r.place) : undefined;
      } else if (x.tries >= 1) {
        x.status = "unmatched";
      }
    }
  }
  return matched;
}

let lastSync = 0;

/** 알림 가져오기 + 가게 맞추기. 앱이 켜질 때, 백그라운드 작업에서 부른다 */
export function syncPayments(opts: { fallbackLoc?: { lat: number; lng: number } | null; force?: boolean } = {}) {
  return serial(async () => {
    if (!opts.force && Date.now() - lastSync < 20 * 1000) return { added: 0, matched: 0 };
    lastSync = Date.now();
    const list = [...(await load())].map((r) => ({ ...r }));
    const raws = getPendingPayments();
    const added = ingest(list, raws, opts.fallbackLoc);
    // 먼저 저장하고 나서 네이티브 쪽을 비운다 (중간에 꺼져도 잃지 않게)
    await persist(list);
    if (raws.length) ackPayments(Math.max(...raws.map((r) => r.postedAt)));
    const matched = await matchPending(list);
    if (matched || list.some((x) => x.tries)) await persist(list);
    return { added, matched };
  });
}

export function addManualPayment(place: PlaceSnap, amount: number, at: number) {
  return mutate((list) => {
    list.push({ id: `manual:${at}:${place.id}`, at, amount, merchant: place.name, sources: ["직접 입력"], status: "matched", place, manual: true });
  });
}

export function updatePayment(id: string, patch: Partial<PaymentRecord>) {
  return mutate((list) => {
    const x = list.find((r) => r.id === id);
    if (x) Object.assign(x, patch);
  });
}

export function removePayment(id: string) {
  return mutate((list) => list.filter((r) => r.id !== id));
}

/** 가맹점 이름을 고쳐서 다시 찾기 */
export async function rematchPayment(id: string, merchant: string) {
  await updatePayment(id, { merchant: merchant.trim(), status: "pending", tries: 0, place: undefined, reason: undefined, hidden: false });
  return syncPayments({ force: true });
}

export function usePayments() {
  const [list, setList] = useState<PaymentRecord[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setList);
    load().then(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  const forPlace = useCallback((placeId: string) => list.filter((x) => x.place?.id === placeId && x.status === "matched" && !x.hidden), [list]);
  return { list, forPlace };
}
