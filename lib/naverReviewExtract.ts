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
  /** 못 읽었을 때 원인 찾기용 (페이지 구조 요약) */
  diag?: Record<string, unknown>;
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

  // 방문자 리뷰 별점·수, 예약 가능 여부 (Apollo 캐시 → 화면). 값이 안쪽 객체에 들어 있어도 찾는다
  function extras(st) {
    var rating = null, count = null, booking = null;
    function scan(o, where, d) {
      if (!o || typeof o !== "object" || d > 4) return;
      for (var f in o) {
        var v = o[f], w = where + "." + f;
        if (typeof v === "number") {
          if (rating == null && /(visitorReviewsScore|visitorReviewScore|avgRating|averageRating|starAverage)$/i.test(f) && v > 0 && v <= 5) rating = v;
          if (count == null && /(visitorReviewsTotal|visitorReviewCount)$/i.test(f) && v >= 0) count = v;
          if (count == null && /^(totalCount|total)$/.test(f) && /VisitorReview/i.test(where) && v >= 0) count = v;
        } else if (typeof v === "string") {
          if (!booking && /^https?:\/\/[^ ]*booking\.naver\.com/.test(v)) booking = v;
        } else if (v === true) {
          if (!booking && /^(hasBooking|isBooking|bookingAvailable|hasNaverBooking)$/i.test(f)) booking = "tab";
        } else if (v && typeof v === "object" && !v.__ref) scan(v, w, d + 1);
      }
    }
    if (st && typeof st === "object") for (var k in st) scan(st[k], k + " " + str(st[k] && st[k].__typename), 0);
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
    if (count == null) {
      var m2 = str(document.body && document.body.innerText).match(/방문자\s*리뷰\s*([\d,]+)/);
      if (m2) count = Number(m2[1].replace(/,/g, ""));
    }
    return { stats: { rating: rating, count: count }, booking: booking };
  }

  // Apollo 상태: 서버가 넣어 둔 것(__APOLLO_STATE__) + 화면이 나중에 받아 둔 캐시(__APOLLO_CLIENT__)
  function states() {
    var out = [];
    try { if (window.__APOLLO_STATE__) out.push(window.__APOLLO_STATE__); } catch (e) {}
    try { var c = window.__APOLLO_CLIENT__; if (c && c.cache && c.cache.extract) out.push(c.cache.extract()); } catch (e) {}
    return out;
  }

  // 못 읽었을 때 원인 찾기용 요약: 어떤 데이터가 있었는지, 리뷰 탭 글자와 주소
  function diag(sts) {
    var types = {}, keys = 0;
    for (var s = 0; s < sts.length; s++) for (var k in sts[s]) {
      keys++;
      var tn = str(sts[s][k] && sts[s][k].__typename) || k.split(":")[0];
      types[tn] = (types[tn] || 0) + 1;
    }
    var top = Object.keys(types).sort(function (a, b) { return types[b] - types[a]; }).slice(0, 15).map(function (t) { return t + ":" + types[t]; });
    var tabs = [], as = document.querySelectorAll("a, [role=tab], button");
    for (var i = 0; i < as.length && tabs.length < 10; i++) {
      var tx = str(as[i].innerText).replace(/\s+/g, " ").trim();
      if (tx && tx.length < 30 && /리뷰/.test(tx)) tabs.push(tx + " → " + (as[i].getAttribute("href") || "-") + (as[i].getAttribute("aria-selected") === "true" ? " [선택]" : ""));
    }
    var scripts = [], ss = document.querySelectorAll("script");
    for (var j = 0; j < ss.length; j++) { var m = (ss[j].textContent || "").match(/window\.(__[A-Z_]+__)\s*=/g); if (m) scripts = scripts.concat(m); }
    return { states: sts.length, keys: keys, types: top, li: document.querySelectorAll("li").length, tabs: tabs, scripts: scripts.slice(0, 6), text: str(document.body && document.body.innerText).replace(/\s+/g, " ").slice(0, 300) };
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    var r = [], how = "none", sts = states();
    for (var s = 0; s < sts.length && !r.length; s++) { try { r = fromState(sts[s]); if (r.length) how = "apollo"; } catch (e) {} }
    if (!r.length) { try { r = fromScripts(); if (r.length) how = "script"; } catch (e) {} }
    if (!r.length && tries > 3) { try { r = fromDom(); if (r.length) how = "dom"; } catch (e) {} }
    // 리뷰 목록이 늦게 그려지는 화면: 조금 내려서 불러오게
    if (!r.length && tries === 6) { try { window.scrollTo(0, document.body.scrollHeight / 2); } catch (e) {} }
    if (r.length || tries > 30) {
      clearInterval(timer);
      var ex = { stats: { rating: null, count: null }, booking: null };
      try { var merged = {}; for (var q = 0; q < sts.length; q++) for (var kk in sts[q]) merged[kk] = sts[q][kk]; ex = extras(merged); } catch (e) {}
      var dg = null;
      if (!r.length) { try { dg = diag(sts); } catch (e) { dg = { error: String(e) }; } }
      var msg = JSON.stringify({ type: "naverReviews", how: how, reviews: r.slice(0, 20), stats: ex.stats, booking: ex.booking, url: location.href, title: document.title, diag: dg });
      window.__naverReviews = msg;
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    }
  }, 400);
})();
true;`;

/** 리뷰 본문을 읽을 페이지: PC용(서버가 리뷰 20개쯤을 페이지에 담아 보냄) 먼저, 안 되면 모바일 */
export function naverVisitorReviewPages(naverId: string) {
  return [
    `https://pcmap.place.naver.com/restaurant/${naverId}/review/visitor?reviewSort=recent`,
    `https://m.place.naver.com/restaurant/${naverId}/review/visitor?reviewSort=recent`,
  ];
}
export function naverVisitorReviewPage(naverId: string) {
  return naverVisitorReviewPages(naverId)[1];
}

/**
 * 네이버 검색 결과 화면에서 이 가게의 플레이스 id 찾기 (페이지 안에서 실행).
 * 폰에서 네이버 검색 API(allSearch)가 막혀 id 를 모를 때, 검색 화면을 열어 가게 링크에서 id 를 읽는다.
 * 찾으면 { type: "naverPlaceId", id } 를 보낸다 (못 찾으면 id: null). 검색 화면에서만 동작.
 */
export function naverFindPlaceJs(name: string) {
  const want = name.replace(/\(.*?\)/g, "").replace(/[\s·\-_.,'"!&]/g, "").toLowerCase();
  return String.raw`(function () {
  if (window.__naverPick || !/(^|\.)search\.naver\.com$|^m\.map\.naver\.com$|^map\.naver\.com$/.test(location.hostname)) return;
  window.__naverPick = true;
  var want = ${JSON.stringify(want)};
  function norm(s) { return String(s || "").replace(/\(.*?\)/g, "").replace(/[\s·\-_.,'"!&]/g, "").toLowerCase(); }
  function post(o) { var s = JSON.stringify(o); window.__naverPlaceId = s; if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s); }
  var n = 0;
  var t = setInterval(function () {
    n++;
    var best = null, bestScore = 0;
    var as = document.querySelectorAll("a[href]");
    for (var i = 0; i < as.length; i++) {
      var h = as[i].href || "";
      var m = h.match(/place\.naver\.com\/(?:restaurant|place|cafe|hairshop|accommodation)\/(\d{4,})/) || h.match(/map\.naver\.com\/(?:p\/)?(?:entry\/)?place\/(\d{4,})/);
      if (!m) continue;
      var box = as[i].closest("li") || as[i];
      var tx = norm(as[i].innerText) || norm(box.innerText).slice(0, 60);
      var score = tx && want && (tx.indexOf(want) >= 0 || want.indexOf(tx) >= 0) ? 2 : 1;
      if (score > bestScore) { best = m[1]; bestScore = score; }
    }
    if (best && (bestScore === 2 || n > 8)) { clearInterval(t); post({ type: "naverPlaceId", id: best, score: bestScore }); }
    else if (n > 30) { clearInterval(t); post({ type: "naverPlaceId", id: null, links: as.length, url: location.href, title: document.title }); }
  }, 300);
})();
true;`;
}

/** 가게 id 를 모를 때 여는 네이버 검색 (결과에 플레이스 링크가 들어 있다) */
export function naverPlaceSearchUrl(query: string) {
  return `https://m.search.naver.com/search.naver?where=m&sm=mtp_hty&query=${encodeURIComponent(query.trim())}`;
}
