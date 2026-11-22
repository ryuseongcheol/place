import { useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";
import { lookupNaverPlace, naverBookingUrl, type NaverPlaceInfo } from "./naverDevice";
import {
  dedupePhotos,
  NAVER_BLOG_EXTRACT_JS,
  NAVER_REVIEW_EXTRACT_JS,
  naverBlogReviewPages,
  naverFindPlaceJs,
  naverPlaceSearchUrl,
  naverVisitorReviewPages,
  type NaverBlogReview,
  type NaverReviewResult,
  type NaverVisitorReview,
} from "./shared";
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
/** 블로그 리뷰 탭 글도 같은 기간 기억 */
const blogCache = new Map<string, { at: number; blogs: NaverBlogReview[]; count: number | null }>();

export type NaverBlogStatus = "idle" | "loading" | "done" | "failed";

/** 새로 읽은 네이버 리뷰 수를 상세 위쪽 요약 줄에도 쓰도록 나눠 둔다 (우리 장소 id 별) */
type LiveCounts = { visitor: number | null; blog: number | null };
const live = new Map<string, LiveCounts>();
const liveSubs = new Set<() => void>();
function publishCounts(placeId: string, c: LiveCounts) {
  const prev = live.get(placeId);
  if (prev && prev.visitor === c.visitor && prev.blog === c.blog) return;
  live.set(placeId, c);
  liveSubs.forEach((f) => f());
}
/** 상세 위쪽 요약 줄용: 리뷰 페이지에서 읽은 네이버 방문자·블로그 리뷰 수 (아직이면 null) */
export function useNaverCounts(placeId: string): LiveCounts | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    liveSubs.add(f);
    return () => {
      liveSubs.delete(f);
    };
  }, []);
  return live.get(placeId) ?? null;
}
const TTL = 30 * 60 * 1000;

/** 검색 화면에서 찾아낸 네이버 장소 id (우리 장소 id 별, 앱을 켜 둔 동안) */
const foundIds = new Map<string, string>();
export function rememberNaverId(placeId: string, naverId: string) {
  foundIds.set(placeId, naverId);
}
export function knownNaverId(p: { id: string; naver?: { naverId?: string | null } | null }) {
  return p.naver?.naverId ?? foundIds.get(p.id) ?? null;
}

/** 지번 주소에서 동 이름 (네이버 검색어 보조) */
export function dongOf(address: string) {
  return address.split(/\s+/).find((t) => /(동|가|읍|면|리)$/.test(t) && !/^\d/.test(t)) ?? null;
}
/** 네이버 검색어: "반포1동 오도로키우동" */
export function naverQueryOf(p: { name: string; address: string }) {
  return `${dongOf(p.address) ?? ""} ${p.name}`.trim();
}

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
  /** 못 읽었을 때 원인 찾기용 기록 (사용자가 공유해서 보내 줄 수 있게) */
  diag: string | null;
  /** 네이버 플레이스 '블로그 리뷰' 탭의 글 (블로그 검색 결과가 아니라 가게에 연결된 글) */
  blogs: NaverBlogReview[];
  blogStatus: NaverBlogStatus;
}

/** PC용 페이지는 PC 브라우저처럼 열어야 모바일 페이지로 넘어가지 않는다 */
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * 상세 화면용 네이버 정보: 장소 찾기(폰에서 네이버 검색) + 방문자 리뷰 페이지 읽기.
 * 공식 API가 없어 보이지 않는 웹뷰로 리뷰 페이지를 열고 lib/naverReviewExtract.ts 스크립트로 뽑는다.
 */
export function useNaverPlace(p: ScoredPlace): NaverPlaceData {
  const [info, setInfo] = useState<NaverPlaceInfo | null>(null);
  const [naverId, setNaverId] = useState<string | null>(knownNaverId(p));
  const [status, setStatus] = useState<NaverReviewStatus>(knownNaverId(p) ? "loading" : "finding");
  /** 폰 네이버 검색(allSearch)이 막혔을 때: 네이버 검색 화면을 몰래 열어 id 찾기 */
  const [searching, setSearching] = useState(false);
  const [got, setGot] = useState<Fetched | null>(null);
  /** 리뷰 페이지 후보 중 몇 번째를 읽는 중인지 (PC → 모바일) */
  const [page, setPage] = useState(0);
  const naverIdRef = useRef<string | null>(naverId);
  naverIdRef.current = naverId;
  const notes = useRef<unknown[]>([]);
  const [diag, setDiag] = useState<string | null>(null);
  const note = (o: unknown) => {
    notes.current.push(o);
    setDiag(JSON.stringify({ place: p.name, naverId: naverIdRef.current, notes: notes.current }, null, 1));
  };
  /** 한 페이지에서 결과를 두 번 받지 않게 (페이지가 다른 주소로 넘어가면 스크립트가 다시 돈다) */
  const handled = useRef("");
  // 블로그 리뷰 탭: 방문자 리뷰를 다 읽은 뒤에 이어서 (웹뷰를 한 번에 하나만)
  const [blogs, setBlogs] = useState<NaverBlogReview[]>([]);
  const [blogCount, setBlogCount] = useState<number | null>(null);
  const [blogStatus, setBlogStatus] = useState<NaverBlogStatus>("idle");
  const [blogPage, setBlogPage] = useState(0);
  const blogHandled = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setInfo(null);
    setGot(null);
    setSearching(false);
    setPage(0);
    notes.current = [];
    setDiag(null);
    setBlogs([]);
    setBlogCount(null);
    setBlogStatus("idle");
    setBlogPage(0);
    const begin = (id: string | null) => {
      if (!alive) return;
      setNaverId(id);
      if (id) foundIds.set(p.id, id);
      if (!id) return setStatus("noid");
      const hit = cache.get(id);
      if (hit && Date.now() - hit.at < TTL) {
        setGot(hit.v);
        return setStatus(hit.v.reviews.length ? "done" : "failed");
      }
      setStatus("loading");
    };
    const known = knownNaverId(p);
    if (known) begin(known);
    else setStatus("finding");
    // 예약 주소·리뷰 수는 폰에서 네이버 검색으로 (서버가 id 를 몰랐으면 id 도)
    lookupNaverPlace(p)
      .then((i) => {
        if (!alive) return;
        setInfo(i);
        if (known) return;
        if (i?.id) begin(i.id);
        else {
          if (alive) note({ step: "allSearch", found: false });
          setSearching(true);
        }
      })
      .catch((e: Error) => {
        if (!alive || known) return;
        note({ step: "allSearch", error: String(e?.message ?? e) });
        setSearching(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  // 검색 화면에서도 못 찾으면 포기
  useEffect(() => {
    if (!searching) return;
    const t = setTimeout(() => {
      setSearching(false);
      note({ step: "searchPage", timeout: true });
      setStatus((s) => (s === "finding" ? "noid" : s));
    }, 15000);
    return () => clearTimeout(t);
  }, [searching]);

  const onSearchMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data) as { type?: string; id?: string | null };
      if (m.type !== "naverPlaceId") return;
      setSearching(false);
      note({ step: "searchPage", ...m });
      if (m.id && /^\d+$/.test(m.id)) {
        foundIds.set(p.id, m.id);
        setNaverId(m.id);
        const hit = cache.get(m.id);
        if (hit && Date.now() - hit.at < TTL) {
          setGot(hit.v);
          setStatus(hit.v.reviews.length ? "done" : "failed");
        } else setStatus("loading");
      } else setStatus("noid");
    } catch {
      // 다른 메시지
    }
  };

  const pages = naverId ? naverVisitorReviewPages(naverId) : [];
  /** 이 페이지에서 못 읽었으면 다음 후보로, 다 안 되면 실패 */
  const nextPage = (why: unknown) => {
    const key = `${naverId}|${page}`;
    if (handled.current === key) return;
    handled.current = key;
    note({ step: "reviewPage", page: pages[page], ...(typeof why === "object" && why ? why : { why }) });
    if (page + 1 < pages.length) setPage(page + 1);
    else setStatus("failed");
  };

  // 페이지마다 너무 오래 걸리면 다음으로
  useEffect(() => {
    if (status !== "loading") return;
    timer.current = setTimeout(() => nextPage({ timeout: true }), 15000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, naverId, page]);

  // 블로그 리뷰 탭 읽기: 방문자 리뷰가 끝나면 (기억해 둔 게 있으면 그것)
  const blogPages = naverId ? naverBlogReviewPages(naverId) : [];
  useEffect(() => {
    if (!naverId || blogStatus !== "idle" || (status !== "done" && status !== "failed")) return;
    const hit = blogCache.get(naverId);
    if (hit && Date.now() - hit.at < TTL) {
      setBlogs(hit.blogs);
      setBlogCount(hit.count);
      setBlogStatus(hit.blogs.length ? "done" : "failed");
    } else setBlogStatus("loading");
  }, [status, naverId, blogStatus]);
  const nextBlogPage = () => {
    const key = `${naverId}|${blogPage}`;
    if (blogHandled.current === key) return;
    blogHandled.current = key;
    if (blogPage + 1 < blogPages.length) setBlogPage(blogPage + 1);
    else setBlogStatus("failed");
  };
  useEffect(() => {
    if (blogStatus !== "loading") return;
    const t = setTimeout(nextBlogPage, 13000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blogStatus, naverId, blogPage]);
  const onBlogMessage = (e: WebViewMessageEvent) => {
    try {
      const r = JSON.parse(e.nativeEvent.data) as NaverReviewResult;
      if (r.type !== "naverReviews") return;
      const list = (r.blogs ?? []).filter((b) => b.title && b.url);
      const count = r.stats?.blogCount ?? null;
      if (count != null) setBlogCount(count);
      if (!list.length) return nextBlogPage();
      blogHandled.current = `${naverId}|${blogPage}`;
      setBlogs(list);
      setBlogStatus("done");
      if (naverId) blogCache.set(naverId, { at: Date.now(), blogs: list, count });
    } catch {
      nextBlogPage();
    }
  };

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const r = JSON.parse(e.nativeEvent.data) as NaverReviewResult;
      if (r.type !== "naverReviews") return;
      const v: Fetched = { reviews: r.reviews.filter((x) => x.body.trim()).map((x) => ({ ...x, photos: dedupePhotos(x.photos) })), stats: r.stats ?? { rating: null, count: null }, booking: r.booking ?? null };
      if (!v.reviews.length) {
        // 별점·수·예약은 건졌으면 남겨 두고 다음 페이지로
        if (v.stats.rating != null || v.stats.count != null || v.booking) setGot((g) => g ?? v);
        return nextPage({ how: r.how, url: r.url, title: r.title, diag: r.diag });
      }
      if (naverId) cache.set(naverId, { at: Date.now(), v });
      handled.current = `${naverId}|${page}`;
      setGot(v);
      setStatus("done");
      // 방문자 페이지에 블로그 글이 미리 들어 있으면 먼저 보여 주고, 블로그 탭에서 전체를 이어서 읽는다
      if (r.blogs?.length) setBlogs((b) => (b.length ? b : r.blogs!));
    } catch (err) {
      nextPage({ error: String(err) });
    }
  };

  const bookingFound = got?.booking ?? info?.bookingUrl ?? null;
  const bookingUrl = bookingFound && naverId ? naverBookingUrl(naverId, /^https?:/.test(bookingFound) ? bookingFound : info?.bookingUrl) : null;

  const probe = searching ? (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        source={{ uri: naverPlaceSearchUrl(naverQueryOf(p)) }}
        injectedJavaScript={naverFindPlaceJs(p.name)}
        onMessage={onSearchMessage}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(req) => /^https?:/i.test(req.url)}
        onError={() => {
          setSearching(false);
          setStatus("noid");
        }}
        style={{ width: 360, height: 640 }}
      />
    </View>
  ) : status === "loading" && naverId && pages[page] ? (
      <View style={styles.hidden} pointerEvents="none">
        <WebView
          key={pages[page]}
          source={{ uri: pages[page] }}
          userAgent={pages[page].includes("pcmap.") ? DESKTOP_UA : undefined}
          injectedJavaScript={NAVER_REVIEW_EXTRACT_JS}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(req) => /^https?:/i.test(req.url)}
          onError={(ev) => nextPage({ loadError: ev.nativeEvent.description })}
          onHttpError={(ev) => ev.nativeEvent.statusCode >= 400 && nextPage({ http: ev.nativeEvent.statusCode })}
          style={{ width: 360, height: 640 }}
        />
      </View>
    ) : blogStatus === "loading" && naverId && blogPages[blogPage] ? (
      <View style={styles.hidden} pointerEvents="none">
        <WebView
          key={blogPages[blogPage]}
          source={{ uri: blogPages[blogPage] }}
          userAgent={blogPages[blogPage].includes("pcmap.") ? DESKTOP_UA : undefined}
          injectedJavaScript={NAVER_BLOG_EXTRACT_JS}
          onMessage={onBlogMessage}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(req) => /^https?:/i.test(req.url)}
          onError={() => nextBlogPage()}
          onHttpError={(ev) => ev.nativeEvent.statusCode >= 400 && nextBlogPage()}
          style={{ width: 360, height: 640 }}
        />
      </View>
    ) : null;

  const visitorCount = got?.stats.count ?? (info?.visitorReviewCount || null) ?? (p.naver?.visitorReviewCount || null);
  const blogTotal = got?.stats.blogCount ?? blogCount ?? (info?.blogReviewCount || p.naver?.blogReviewCount || null);
  useEffect(() => {
    if (got?.stats.count != null || got?.stats.blogCount != null || blogCount != null) publishCounts(p.id, { visitor: visitorCount, blog: blogTotal });
  }, [p.id, visitorCount, blogTotal, got, blogCount]);

  return {
    naverId,
    info,
    status,
    reviews: got?.reviews ?? [],
    rating: got?.stats.rating ?? p.naver?.rating ?? null,
    visitorCount,
    // 리뷰 페이지에서 읽은 수(사용자가 네이버에서 보는 숫자)를 먼저
    blogCount: blogTotal,
    bookingUrl,
    probe,
    diag: status === "failed" || status === "noid" ? diag ?? JSON.stringify({ place: p.name, naverId, status }) : null,
    blogs,
    blogStatus,
  };
}

const styles = StyleSheet.create({
  hidden: { position: "absolute", left: 0, top: 0, width: 360, height: 2, opacity: 0, overflow: "hidden" },
});
