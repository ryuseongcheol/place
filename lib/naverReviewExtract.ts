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
  /** 동영상 (첫 장면 그림 + 재생 주소. 주소를 못 찾으면 null 이라 네이버에서 본다) */
  videos?: Array<{ thumbnail: string | null; url: string | null }>;
  keywords: string[];
}

/** 네이버 플레이스 '블로그 리뷰' 탭의 글 (가게에 연결된 블로그·카페 글) */
export interface NaverBlogReview {
  id: string;
  title: string;
  body: string;
  url: string;
  author: string | null;
  date: string | null;
  thumbnail: string | null;
  kind: "blog" | "cafe" | "other";
}

export interface NaverReviewResult {
  type: "naverReviews";
  how: "apollo" | "script" | "dom" | "none";
  reviews: NaverVisitorReview[];
  /** 방문자 리뷰 별점·전체 수, 블로그 리뷰 수 (페이지에 있을 때) */
  stats: { rating: number | null; count: number | null; blogCount?: number | null };
  /** 네이버 예약: 예약 주소, 예약 탭만 있으면 "tab", 없으면 null */
  booking: string | null;
  url: string;
  title: string;
  /** 블로그 리뷰 탭의 글 (방문자 페이지에도 일부 들어 있고, 블로그 탭 페이지에서 읽으면 더 많다) */
  blogs?: NaverBlogReview[];
  /** 어느 탭을 읽었는지 */
  mode?: "visitor" | "blog";
  /** 못 읽었을 때 원인 찾기용 (페이지 구조 요약) */
  diag?: Record<string, unknown>;
}

const EXTRACT_JS = String.raw`(function () {
  if (window.__naverReviewRunning) return;
  window.__naverReviewRunning = true;
  var MODE = "__MODE__";
  var DATE = /\d{1,2}\.\d{1,2}\.[월화수목금토일]/;
  function str(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
  function img(u) { u = str(u); if (!u) return null; if (u.indexOf("//") === 0) u = "https:" + u; return /^https?:/.test(u) ? u : null; }
  function uniq(a) { var o = [], s = {}; for (var i = 0; i < a.length; i++) { if (a[i] && !s[a[i]]) { s[a[i]] = 1; o.push(a[i]); } } return o; }
  // 같은 사진인지: 크기 옵션(?type=w560 등)과 검색 프록시(search.pstatic.net/common/?src=…)를 걷어낸 경로로 비교
  function photoKey(u) {
    try {
      var x = new URL(u), src = x.searchParams.get("src");
      if (src) x = new URL(src.indexOf("//") === 0 ? "https:" + src : src);
      return decodeURIComponent(x.pathname).replace(/\/+$/, "").toLowerCase();
    } catch (e) { return String(u).split("?")[0]; }
  }
  function uniqPhotos(a) { var o = [], s = {}; for (var i = 0; i < a.length; i++) { if (!a[i]) continue; var k = photoKey(a[i]); if (!s[k]) { s[k] = 1; o.push(a[i]); } } return o; }

  // 동영상 재생 주소: 영상 파일(mp4·m3u8 등)이거나, 이름이 영상 주소인 필드
  function videoUrl(m) {
    for (var k in m) {
      var v = m[k];
      if (typeof v !== "string" || !/^(https?:)?\/\//.test(v)) continue;
      if (/\.(mp4|m3u8|mov|webm)(\?|$)/i.test(v) || (/video|trailer|vod|play/i.test(k) && !/thumb|image|poster/i.test(k))) return v.indexOf("//") === 0 ? "https:" + v : v;
    }
    return null;
  }

  function cleanText(t) { return str(t).replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim(); }
  // 블로그 리뷰 탭 글 (Apollo 의 FsasReview 등)
  function toBlog(o, deref) {
    var url = str(o.url || o.link || o.contentUrl || o.postUrl);
    if (url.indexOf("//") === 0) url = "https:" + url;
    var title = cleanText(o.title);
    if (!/^https?:/.test(url) || !title) return null;
    var thumbs = o.thumbnailUrlList || o.thumbnailUrls || o.images || [];
    var t0 = Array.isArray(thumbs) && thumbs.length ? deref(thumbs[0]) : null;
    var th = img(o.thumbnailUrl || o.thumbnail || (typeof t0 === "string" ? t0 : t0 && (t0.url || t0.thumbnail)));
    var a = deref(o.author) || {};
    var kindText = str(o.type) + " " + str(o.typeName) + " " + url;
    return {
      id: str(o.id || url),
      title: title.slice(0, 120),
      body: cleanText(o.contents || o.content || o.description || o.body || o.summary).slice(0, 300),
      url: url,
      author: str(o.name || o.authorName || o.blogName || o.nickname || a.nickname || a.name) || null,
      date: str(o.date || o.createdString || o.created || o.createdAt) || null,
      thumbnail: th,
      kind: /cafe/i.test(kindText) ? "cafe" : /blog|post/i.test(kindText) ? "blog" : "other",
    };
  }
  function blogsFromState(st) {
    if (!st || typeof st !== "object") return [];
    var deref = function (v) { return v && v.__ref ? st[v.__ref] : v; };
    var out = [], seen = {};
    for (var k in st) {
      var o = st[k];
      if (!o || typeof o !== "object" || !/Fsas|Ugc|Blog|Cafe/i.test(str(o.__typename) + " " + k)) continue;
      var b = toBlog(o, deref);
      if (b && !seen[b.url]) { seen[b.url] = 1; out.push(b); }
    }
    return out;
  }
  // 화면에서: 블로그·카페 글로 가는 링크가 있는 항목
  function blogsFromDom() {
    var out = [], seen = {};
    var as = document.querySelectorAll("a[href]");
    for (var i = 0; i < as.length && out.length < 20; i++) {
      var h = as[i].href || "";
      if (!/(blog|cafe|post|in)\.naver\.com|tistory\.com|brunch\.co\.kr/.test(h) || !/\/\d{6,}|logNo=|PostView|articleid=|\/articles\//i.test(h) || seen[h]) continue;
      var box = as[i].closest("li") || as[i];
      var lines = str(box.innerText).split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
      if (!lines.length) continue;
      seen[h] = 1;
      var title = cleanText(as[i].innerText).split(" ").length > 1 && cleanText(as[i].innerText).length < 120 ? cleanText(as[i].innerText) : lines[0];
      var body = "";
      for (var j = 0; j < lines.length; j++) if (lines[j].length > body.length && lines[j] !== title) body = lines[j];
      var dm = str(box.innerText).match(/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?|\d{1,2}\.\d{1,2}\.[월화수목금토일]/);
      var im = box.querySelector("img");
      out.push({ id: h, title: title.slice(0, 120), body: body.slice(0, 300), url: h, author: null, date: dm ? dm[0] : null, thumbnail: im ? img(im.currentSrc || im.src) : null, kind: /cafe/.test(h) ? "cafe" : "blog" });
    }
    return out;
  }

  function toReview(o, deref) {
    var body = str(o.body || o.content || o.reviewBody).trim();
    if (body.length < 2) return null;
    var a = deref(o.author) || {};
    var media = (o.media || o.images || o.photos || []).map(deref).filter(Boolean);
    var photos = [], videos = [];
    for (var mi = 0; mi < media.length; mi++) {
      var m = media[mi], vu = videoUrl(m);
      var thumb = img(m.thumbnail || m.thumbnailUrl || m.imageUrl || (vu ? null : m.url || m.src));
      if (vu || /video|movie|clip/i.test(str(m.type || m.mediaType || m.__typename))) videos.push({ thumbnail: thumb, url: vu });
      else if (thumb) photos.push(thumb);
    }
    // 리뷰 대표 사진(thumbnail)은 보통 첨부 사진 첫 장과 같은 사진이라 첨부가 없을 때만
    if (!photos.length && o.thumbnail) photos.push(img(o.thumbnail));
    var kws = (o.votedKeywords || o.keywords || []).map(deref).filter(Boolean).map(function (k) { return str(k.name || k.displayName || k); });
    return {
      id: str(o.id || o.reviewId || body.slice(0, 20)),
      body: body.slice(0, 1500),
      nickname: str(a.nickname || a.name || o.nickname) || null,
      visited: str(o.visited || o.visitDate || o.visitDateTime || o.created) || null,
      visitCount: typeof o.visitCount === "number" ? o.visitCount : null,
      photos: uniqPhotos(photos).slice(0, 6),
      videos: videos.slice(0, 3),
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
      out.push({ id: "dom-" + out.length, body: best.slice(0, 1500), nickname: lines[0] && lines[0].length <= 20 ? lines[0] : null, visited: (text.match(DATE) || [null])[0], visitCount: vc ? Number(vc[1]) : null, photos: uniqPhotos(imgs).slice(0, 6), keywords: [] });
    }
    return out;
  }

  // 방문자 리뷰 별점·수, 블로그 리뷰 수, 예약 가능 여부.
  // 수는 화면에 보이는 글자("방문자 리뷰 632", "블로그 리뷰 193", "별점 4.52")를 먼저 믿는다 (사용자가 보는 숫자).
  // 없으면 Apollo 캐시에서 이름이 확실한 필드만 (리뷰 작성자 정보의 "리뷰 수·평균"을 잘못 집지 않게)
  function extras(st) {
    var rating = null, count = null, blogCount = null, booking = null;
    var body = str(document.body && document.body.innerText);
    var mv = body.match(/방문자\s*리뷰\s*([\d,]+)/), mb = body.match(/블로그\s*리뷰\s*([\d,]+)/), mr = body.match(/별점\s*([0-5]\.\d{1,2})/);
    if (mv) count = Number(mv[1].replace(/,/g, ""));
    if (mb) blogCount = Number(mb[1].replace(/,/g, ""));
    if (mr) rating = Number(mr[1]);
    var PERSON = /author|owner|writer|reviewer|user|profile/i;
    function scan(o, where, d) {
      if (!o || typeof o !== "object" || d > 4 || PERSON.test(where)) return;
      for (var f in o) {
        var v = o[f], w = where + "." + f;
        if (typeof v === "number") {
          if (rating == null && /^(visitorReviewsScore|visitorReviewScore)$/.test(f) && v > 0 && v <= 5) rating = v;
          if (rating == null && /^avgRating$/.test(f) && /VisitorReviewStats/i.test(where) && v > 0 && v <= 5) rating = v;
          if (count == null && /^(visitorReviewsTotal|visitorReviewCount)$/.test(f) && v >= 0) count = v;
          if (count == null && /^totalCount$/.test(f) && /VisitorReviewStats/i.test(where) && v >= 0) count = v;
          if (count == null && /^total$/.test(f) && /^ROOT_QUERY\.visitorReviews\(/.test(where) && v >= 0) count = v;
          if (blogCount == null && /^(fsasReviewsTotal|blogReviewsTotal|blogCafeReviewCount)$/.test(f) && v >= 0) blogCount = v;
          if (blogCount == null && /^total$/.test(f) && /^ROOT_QUERY\.fsasReviews\(/.test(where) && v >= 0) blogCount = v;
        } else if (typeof v === "string") {
          if (!booking && /^https?:\/\/[^ ]*booking\.naver\.com/.test(v)) booking = v;
        } else if (v === true) {
          if (!booking && /^(hasBooking|isBooking|bookingAvailable|hasNaverBooking)$/i.test(f)) booking = "tab";
        } else if (v && typeof v === "object" && !v.__ref) scan(v, w, d + 1);
      }
    }
    if (st && typeof st === "object") for (var k in st) scan(st[k], k === "ROOT_QUERY" ? "ROOT_QUERY" : k + " " + str(st[k] && st[k].__typename), 0);
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
    return { stats: { rating: rating, count: count, blogCount: blogCount }, booking: booking };
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
    var r = [], how = "none", sts = states(), blogs = [];
    for (var b = 0; b < sts.length && !blogs.length; b++) { try { blogs = blogsFromState(sts[b]); } catch (e) {} }
    if (MODE === "blog") {
      if (!blogs.length && tries > 3) { try { blogs = blogsFromDom(); } catch (e) {} }
      if (blogs.length) how = "apollo";
      if (!blogs.length && tries === 6) { try { window.scrollTo(0, document.body.scrollHeight / 2); } catch (e) {} }
    } else {
      for (var s = 0; s < sts.length && !r.length; s++) { try { r = fromState(sts[s]); if (r.length) how = "apollo"; } catch (e) {} }
      if (!r.length) { try { r = fromScripts(); if (r.length) how = "script"; } catch (e) {} }
      if (!r.length && tries > 3) { try { r = fromDom(); if (r.length) how = "dom"; } catch (e) {} }
      // 리뷰 목록이 늦게 그려지는 화면: 조금 내려서 불러오게
      if (!r.length && tries === 6) { try { window.scrollTo(0, document.body.scrollHeight / 2); } catch (e) {} }
    }
    var found = MODE === "blog" ? blogs.length : r.length;
    if (found || tries > (MODE === "blog" ? 25 : 30)) {
      clearInterval(timer);
      var ex = { stats: { rating: null, count: null, blogCount: null }, booking: null };
      try { var merged = {}; for (var q = 0; q < sts.length; q++) for (var kk in sts[q]) merged[kk] = sts[q][kk]; ex = extras(merged); } catch (e) {}
      var dg = null;
      if (!found) { try { dg = diag(sts); } catch (e) { dg = { error: String(e) }; } }
      var msg = JSON.stringify({ type: "naverReviews", mode: MODE, how: how, reviews: r.slice(0, 20), blogs: blogs.slice(0, 20), stats: ex.stats, booking: ex.booking, url: location.href, title: document.title, diag: dg });
      window.__naverReviews = msg;
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    }
  }, 400);
})();
true;`;

/** 방문자 리뷰 탭에서 리뷰를 읽는 스크립트 (블로그 글도 들어 있으면 같이) */
export const NAVER_REVIEW_EXTRACT_JS = EXTRACT_JS.replace("__MODE__", "visitor");
/** 블로그 리뷰 탭에서 블로그·카페 글을 읽는 스크립트 */
export const NAVER_BLOG_EXTRACT_JS = EXTRACT_JS.replace("__MODE__", "blog");

/** 리뷰 본문을 읽을 페이지: PC용(서버가 리뷰 20개쯤을 페이지에 담아 보냄) 먼저, 안 되면 모바일 */
export function naverVisitorReviewPages(naverId: string) {
  return [
    `https://pcmap.place.naver.com/restaurant/${naverId}/review/visitor?reviewSort=recent`,
    `https://m.place.naver.com/restaurant/${naverId}/review/visitor?reviewSort=recent`,
  ];
}
/** 같은 사진 빼기 (앱 쪽에서도 한 번 더): 크기 옵션·검색 프록시를 걷어낸 경로로 비교 */
export function dedupePhotos(urls: string[]) {
  const seen = new Set<string>();
  return urls.filter((u) => {
    let k: string;
    try {
      let x = new URL(u);
      const src = x.searchParams.get("src");
      if (src) x = new URL(src.startsWith("//") ? `https:${src}` : src);
      k = decodeURIComponent(x.pathname).replace(/\/+$/, "").toLowerCase();
    } catch {
      k = u.split("?")[0];
    }
    if (!u || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 블로그 리뷰 탭 페이지: PC용 먼저, 안 되면 모바일 */
export function naverBlogReviewPages(naverId: string) {
  return [`https://pcmap.place.naver.com/restaurant/${naverId}/review/ugc`, `https://m.place.naver.com/restaurant/${naverId}/review/ugc`];
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
