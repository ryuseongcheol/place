import { useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";
import { lookupNaverPlace, naverBookingUrl, type NaverPlaceInfo } from "./naverDevice";
import { NAVER_REVIEW_EXTRACT_JS, naverVisitorReviewPage, type NaverReviewResult, type NaverVisitorReview } from "./shared";
import type { ScoredPlace } from "./types";

// react-native-webview 타입이 props 를 never 로 잡아서 명시 (WebViewModal 과 같은 방식)
const WebView = RNWebView as unknown as React.ComponentType<WebViewProps>;

export type NaverReviewStatus = "finding" | "loading" | "done" | "failed" | "noid";

interface Fetched {
  reviews: NaverVisitorReview[];
  stats: NaverReviewResult["stats"];
  booking: string | null;
}

/** 네이버 장소 id 별로 30분 기억 */
const cache = new Map<string, { at: number; v: Fetched }>();
const TTL = 30 * 60 * 1000;

export interface NaverPlaceData {
  naverId: string | null;
  /** 네이버 검색으로 찾은 정보 (리뷰 수·예약 주소 등) */
  info: NaverPlaceInfo | null;
  status: NaverReviewStatus;
  reviews: NaverVisitorReview[];
  /** 방문자 리뷰 별점·수 */
  rating: number | null;
  visitorCount: number | null;
  blogCount: number | null;
  /** 네이버 예약이 되는 곳이면 예약 주소 */
  bookingUrl: string | null;
  /** 화면에 넣어 둘 보이지 않는 웹뷰 (리뷰 페이지를 열어 리뷰·별점·예약 여부를 뽑는다) */
  probe: ReactNode;
}

/**
 * 상세 화면용 네이버 정보: 장소 찾기(폰에서 네이버 검색) + 방문자 리뷰 페이지 읽기.
 * 공식 API가 없어 보이지 않는 웹뷰로 리뷰 페이지를 열고 lib/naverReviewExtract.ts 스크립트로 뽑는다.
 */
export function useNaverPlace(p: ScoredPlace): NaverPlaceData {
  const [info, setInfo] = useState<NaverPlaceInfo | null>(null);
  const [naverId, setNaverId] = useState<string | null>(p.naver?.naverId ?? null);
  const [status, setStatus] = useState<NaverReviewStatus>(p.naver?.naverId ? "loading" : "finding");
  const [got, setGot] = useState<Fetched | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setInfo(null);
    setGot(null);
    const begin = (id: string | null) => {
      if (!alive) return;
      setNaverId(id);
      if (!id) return setStatus("noid");
      const hit = cache.get(id);
      if (hit && Date.now() - hit.at < TTL) {
        setGot(hit.v);
        return setStatus(hit.v.reviews.length ? "done" : "failed");
      }
      setStatus("loading");
    };
    const known = p.naver?.naverId ?? null;
    if (known) begin(known);
    else setStatus("finding");
    // 예약 주소·리뷰 수는 폰에서 네이버 검색으로 (서버가 id 를 몰랐으면 id 도)
    lookupNaverPlace(p)
      .then((i) => {
        if (!alive) return;
        setInfo(i);
        if (!known) begin(i?.id ?? null);
      })
      .catch(() => !known && begin(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  // 너무 오래 걸리면 포기
  useEffect(() => {
    if (status !== "loading") return;
    timer.current = setTimeout(() => setStatus((s) => (s === "loading" ? "failed" : s)), 25000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [status, naverId]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const r = JSON.parse(e.nativeEvent.data) as NaverReviewResult;
      if (r.type !== "naverReviews") return;
      const v: Fetched = { reviews: r.reviews.filter((x) => x.body.trim()), stats: r.stats ?? { rating: null, count: null }, booking: r.booking ?? null };
      if (naverId) cache.set(naverId, { at: Date.now(), v });
      setGot(v);
      setStatus(v.reviews.length ? "done" : "failed");
    } catch {
      setStatus("failed");
    }
  };

  const bookingFound = got?.booking ?? info?.bookingUrl ?? null;
  const bookingUrl = bookingFound && naverId ? naverBookingUrl(naverId, /^https?:/.test(bookingFound) ? bookingFound : info?.bookingUrl) : null;

  const probe =
    status === "loading" && naverId ? (
      <View style={styles.hidden} pointerEvents="none">
        <WebView
          source={{ uri: naverVisitorReviewPage(naverId) }}
          injectedJavaScript={NAVER_REVIEW_EXTRACT_JS}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(req) => /^https?:/i.test(req.url)}
          onError={() => setStatus("failed")}
          style={{ width: 360, height: 640 }}
        />
      </View>
    ) : null;

  return {
    naverId,
    info,
    status,
    reviews: got?.reviews ?? [],
    rating: got?.stats.rating ?? p.naver?.rating ?? null,
    visitorCount: got?.stats.count ?? (info?.visitorReviewCount || null) ?? (p.naver?.visitorReviewCount || null),
    blogCount: info?.blogReviewCount || p.naver?.blogReviewCount || null,
    bookingUrl,
    probe,
  };
}

const styles = StyleSheet.create({
  hidden: { position: "absolute", left: 0, top: 0, width: 360, height: 2, opacity: 0, overflow: "hidden" },
});
