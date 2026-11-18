/**
 * 네이버 플레이스 방문자 리뷰 페이지(m.place.naver.com/.../review/visitor) 안에서 실행해 리뷰를 뽑는 스크립트.
 * 공식 API가 없어서 앱은 보이지 않는 웹뷰로 페이지를 열고 이 스크립트를 넣는다.
 * 네이버 페이지 구조가 바뀌어 리뷰가 안 나오면 이 파일을 고치면 된다.
 *
 * 순서: 1) 페이지에 들어 있는 Apollo 캐시(window.__APOLLO_STATE__) 2) 스크립트 태그 속 JSON 3) 화면 글자(DOM)
 * 결과는 window.ReactNativeWebView.postMessage 로 보내고, 없으면 window.__naverReviews 에 둔다.
 * (Hermes 는 함수 소스를 보관하지 않으므로 문자열로 둔다. 정규식 역슬래시 때문에 String.raw)
 */
export interface NaverVisitorReview {
  id: string;
  body: string;
  nickname: string | null;
  /** 방문 날짜 표기 (예: "11.13.목") */
  visited: string | null;
  /** N번째 방문 */
  visitCount: number | null;
  photos: string[];
  keywords: string[];
}

export interface NaverReviewResult {
  type: "naverReviews";
  how: "apollo" | "script" | "dom" | "none";
  reviews: NaverVisitorReview[];
  /** 방문자 리뷰 별점 평균·전체 수 (페이지에 있을 때) */
  stats: { rating: number | null; count: number | null };
  /** 네이버 예약: 예약 주소, 예약 탭만 있으면 "tab", 없으면 null */
  booking: string | null;
  url: string;
  title: string;
}

export const NAVER_REVIEW_EXTRACT_JS = String.raw`(function () {
  if (window.__naverReviewRunning) return;
  window.__naverReviewRunning = true;
  var DATE = /\d{1,2}\.\d{1,2}\.[월화수목금토일]/;
  function str(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
  function img(u) { u = str(u); if (!u) return null; if (u.indexOf("//") === 0) u = "https:" + u; return /^https?:/.test(u) ? u : null; }
  function uniq(a) { var o = [], s = {}; for (var i = 0; i < a.length; i++) { if (a[i] && !s[a[i]]) { s[a[i]] = 1; o.push(a[i]); } } return o; }

  function toReview(o, deref) {
    var body = str(o.body || o.content || o.reviewBody).trim();
    if (body.length < 2) return null;
    var a = deref(o.author) || {};
    var media = (o.media || o.images || o.photos || []).map(deref).filter(Boolean);
    var photos = media.map(function (m) { return img(m.thumbnail || m.url || m.src || m.imageUrl); });
    if (o.thumbnail) photos.unshift(img(o.thumbnail));
    var kws = (o.votedKeywords || o.keywords || []).map(deref).filter(Boolean).map(function (k) { return str(k.name || k.displayName || k); });
    return {
      id: str(o.id || o.reviewId || body.slice(0, 20)),
      body: body.slice(0, 1500),
      nickname: str(a.nickname || a.name || o.nickname) || null,
      visited: str(o.visited || o.visitDate || o.visitDateTime || o.created) || null,
      visitCount: typeof o.visitCount === "number" ? o.visitCount : null,
      photos: uniq(photos).slice(0, 6),
      keywords: uniq(kws).slice(0, 6),
    };
  }

  function fromState(st) {
    if (!st || typeof st !== "object") return [];
    var deref = function (v) { return v && v.__ref ? st[v.__ref] : v; };
    var visitor = [], other = [];
    for (var k in st) {
      var o = st[k];
      if (!o || typeof o !== "object" || typeof o.body !== "string") continue;
      var tn = str(o.__typename) + " " + k;
      if (/Fsas|Blog|Cafe/i.test(tn)) continue;
      var r = toReview(o, deref);
      if (!r) continue;
      (/VisitorReview/i.test(tn) ? visitor : other).push(r);
    }
    return visitor.length ? visitor : other;
  }

  function fromScripts() {
    var out = [];
    var ss = document.querySelectorAll("script");
    for (var i = 0; i < ss.length && !out.length; i++) {
      var t = ss[i].textContent || "";
      if (t.indexOf("VisitorReview") < 0) continue;
      var m = t.match(/__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});?\s*(window\.|$)/);
      if (m) { try { out = fromState(JSON.parse(m[1])); } catch (e) {} }
    }
    return out;
  }

  function fromDom() {
    var out = [], seen = {};
    var lis = document.querySelectorAll("li");
    for (var i = 0; i < lis.length && out.length < 20; i++) {
      var li = lis[i];
      var text = str(li.innerText).trim();
      if (text.length < 20 || text.length > 4000 || !DATE.test(text)) continue;
      if (li.querySelector("li")) continue; // 바깥 목록이 아닌 개별 항목만
      var best = "";
      var els = li.querySelectorAll("a, span, div, p");
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (el.children.length > 2) continue;
        var t = str(el.innerText).trim();
        if (t.length > best.length && !DATE.test(t.slice(0, 12))) best = t;
      }
      if (best.length < 5 || seen[best]) continue;
      seen[best] = 1;
      var lines = text.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      var imgs = [];
      var ims = li.querySelectorAll("img");
      for (var k = 0; k < ims.length; k++) { var w = ims[k].naturalWidth || ims[k].width; if (w === 0 || w > 60) imgs.push(img(ims[k].currentSrc || ims[k].src)); }
      var vc = text.match(/(\d+)번째 방문/);
      out.push({ id: "dom-" + out.length, body: best.slice(0, 1500), nickname: lines[0] && lines[0].length <= 20 ? lines[0] : null, visited: (text.match(DATE) || [null])[0], visitCount: vc ? Number(vc[1]) : null, photos: uniq(imgs).slice(0, 6), keywords: [] });
    }
    return out;
  }

  // 방문자 리뷰 별점·수, 예약 가능 여부 (Apollo 캐시 → 화면)
  function extras() {
    var rating = null, count = null, booking = null;
    var st = window.__APOLLO_STATE__;
    if (st && typeof st === "object") {
      for (var k in st) {
        var o = st[k];
        if (!o || typeof o !== "object") continue;
        var where = k + " " + str(o.__typename);
        for (var f in o) {
          var v = o[f];
          if (typeof v === "number") {
            if (rating == null && /visitorReviewsScore|visitorReviewScore|avgRating|averageRating|starAverage/i.test(f) && v > 0 && v <= 5) rating = v;
            if (count == null && /visitorReviewsTotal|visitorReviewCount/i.test(f) && v >= 0) count = v;
            if (count == null && /^totalCount$/.test(f) && /VisitorReview/i.test(where) && v >= 0) count = v;
          } else if (typeof v === "string") {
            if (!booking && /^https?:\/\/[^ ]*booking\.naver\.com/.test(v)) booking = v;
          } else if (v === true && !booking && /^(hasBooking|isBooking|bookingAvailable|hasNaverBooking)$/i.test(f)) booking = "tab";
        }
      }
    }
    if (!booking) {
      var as = document.querySelectorAll("a[href]");
      for (var i = 0; i < as.length && !booking; i++) {
        var h = as[i].getAttribute("href") || "", t = str(as[i].innerText).trim();
        if (/booking\.naver\.com/.test(h)) booking = h.indexOf("http") === 0 ? h : "https:" + h;
        else if (/\/booking(\?|\/|$)/.test(h) && /예약/.test(t)) booking = "tab";
      }
    }
    if (!booking) {
      var tabs = document.querySelectorAll("[role=tab], a[role=tab]");
      for (var j = 0; j < tabs.length && !booking; j++) if (str(tabs[j].innerText).trim() === "예약") booking = "tab";
    }
    if (rating == null) {
      var m = str(document.body && document.body.innerText).match(/별점\s*([0-5]\.\d{1,2})/);
      if (m) rating = Number(m[1]);
    }
    return { stats: { rating: rating, count: count }, booking: booking };
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    var r = [], how = "none";
    try { r = fromState(window.__APOLLO_STATE__); if (r.length) how = "apollo"; } catch (e) {}
    if (!r.length) { try { r = fromScripts(); if (r.length) how = "script"; } catch (e) {} }
    if (!r.length && tries > 3) { try { r = fromDom(); if (r.length) how = "dom"; } catch (e) {} }
    if (r.length || tries > 30) {
      clearInterval(timer);
      var ex = { stats: { rating: null, count: null }, booking: null };
      try { ex = extras(); } catch (e) {}
      var msg = JSON.stringify({ type: "naverReviews", how: how, reviews: r.slice(0, 20), stats: ex.stats, booking: ex.booking, url: location.href, title: document.title });
      window.__naverReviews = msg;
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    }
  }, 400);
})();
true;`;

export function naverVisitorReviewPage(naverId: string) {
  return `https://m.place.naver.com/restaurant/${naverId}/review/visitor?reviewSort=recent`;
}
