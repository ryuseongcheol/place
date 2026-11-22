import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewNavigation, type WebViewProps } from "react-native-webview";
import { naverReviewUrl, naverVisitorReviewUrl } from "./naverDevice";
import { rememberNaverId } from "./naverPlace";
import { naverFindPlaceJs } from "./shared";
import type { Colors } from "./theme";

// react-native-webview 타입 정의가 제네릭 기본값(undefined) 때문에 props가 never로 잡혀서 명시적으로 지정
interface WebViewHandle {
  goBack: () => void;
}
const WebView = RNWebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebViewHandle> }>;

export type WebTarget =
  | {
      title: string;
      url: string;
      /** 네이버 검색 결과에서 가게를 누르면 그 가게의 방문자 리뷰 탭으로 바로 보낸다 */
      naverToReviews?: boolean;
      /** 네이버 검색 결과에서 가게를 누르면 그 가게의 예약 탭으로 바로 보낸다 */
      naverToBooking?: boolean;
      /** 페이지가 열리면 이 글자의 탭·버튼을 한 번 눌러 준다 (예: "방문자 리뷰", 구글 "웹사이트로 이동"). 여러 개면 먼저 보이는 것 */
      clickText?: string | string[];
      /**
       * 가게 id 를 몰라 네이버 검색 화면을 열 때: 검색 결과에서 이 가게를 자동으로 골라
       * 그 가게의 방문자(블로그) 리뷰 화면으로 바로 넘어간다. 찾는 동안은 검색 화면을 가린다.
       */
      findNaverPlace?: { placeId: string; name: string; query: string; tab: "visitor" | "blog" };
    }
  | { title: string; photos: string[]; index: number }
  /** 동영상 재생 (리뷰 동영상). 재생이 안 되면 fallbackUrl(네이버 리뷰 화면)을 바깥 브라우저로 */
  | { title: string; video: string; poster?: string | null; fallbackUrl?: string | null };

/** 웹뷰가 부른 앱 링크 열기. intent:// 는 안의 scheme 으로 바꿔 열고, 안 되면 대체 웹 주소로 */
async function openExternal(url: string) {
  try {
    if (url.startsWith("intent:")) {
      const scheme = url.match(/;scheme=([^;]+)/)?.[1];
      const fallback = url.match(/;S\.browser_fallback_url=([^;]+)/)?.[1];
      const pkg = url.match(/;package=([^;]+)/)?.[1];
      const target = scheme ? url.replace(/^intent:/, `${scheme}:`).replace(/#Intent;.*$/, "") : null;
      if (target && (await Linking.canOpenURL(target).catch(() => false))) return Linking.openURL(target);
      if (fallback) return Linking.openURL(decodeURIComponent(fallback));
      if (pkg) return Linking.openURL(`market://details?id=${pkg}`);
      return;
    }
    await Linking.openURL(url);
  } catch {
    // 열 수 있는 앱이 없으면 무시
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** 사진만 보여주는 페이지: 좌우로 넘기고, 두 손가락으로 확대 */
function photoHtml(photos: string[], index: number) {
  const imgs = photos.map((u) => `<div class="s"><img src="${esc(u)}" loading="lazy"/></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes">
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden}
.g{display:flex;height:100%;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.g::-webkit-scrollbar{display:none}
.s{flex:0 0 100%;height:100%;display:flex;align-items:center;justify-content:center;scroll-snap-align:center}
.s img{max-width:100%;max-height:100%;object-fit:contain}
.c{position:fixed;left:0;right:0;bottom:24px;text-align:center;color:#fff;font:600 14px -apple-system,sans-serif;text-shadow:0 1px 3px #000}
</style></head><body>
<div class="g" id="g">${imgs}</div><div class="c" id="c">${index + 1} / ${photos.length}</div>
<script>
var g=document.getElementById('g'),c=document.getElementById('c');
requestAnimationFrame(function(){g.scrollLeft=g.clientWidth*${index};});
g.addEventListener('scroll',function(){c.textContent=(Math.round(g.scrollLeft/g.clientWidth)+1)+' / ${photos.length}';});
</script></body></html>`;
}

/** 동영상만 보여주는 페이지: mp4 는 그대로, m3u8(HLS)은 기기가 못 틀면 hls.js 로 */
function videoHtml(src: string, poster?: string | null) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;background:#000}
.e{position:fixed;left:0;right:0;top:45%;text-align:center;color:#bbb;font:14px -apple-system,sans-serif;display:none}</style></head><body>
<video id="v" controls autoplay playsinline ${poster ? `poster="${esc(poster)}"` : ""}></video><div class="e" id="e">동영상을 재생하지 못했어요</div>
<script>
var v=document.getElementById('v'),src=${JSON.stringify(src)};
function fail(){document.getElementById('e').style.display='block';if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('videoError');}
v.addEventListener('error',fail);
if(/\\.m3u8(\\?|$)/i.test(src)&&!v.canPlayType('application/vnd.apple.mpegurl')){
  var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
  s.onload=function(){if(window.Hls&&Hls.isSupported()){var h=new Hls();h.loadSource(src);h.attachMedia(v);h.on(Hls.Events.ERROR,function(e,d){if(d.fatal)fail();});}else fail();};
  s.onerror=fail;document.head.appendChild(s);
}else{v.src=src;}
</script></body></html>`;
}

/**
 * 페이지 안에서 원하는 탭(글자)을 찾아 그 탭으로 옮기고 그 자리로 스크롤. 탭 이름 옆 숫자는 무시한다 ("방문자 리뷰 632").
 * 네이버 플레이스: 탭이 링크면 누르지 않고 그 링크 주소로 바로 간다 (화면이 준비되기 전에 누르면 헛눌리기 때문).
 *   이미 그 탭 주소면 그대로. 링크가 아니면 골라질 때까지 몇 번 다시 누른다.
 * 그 밖의 사이트(구글 "웹사이트로 이동" 등): 한 번 누른다. 네이버 검색 화면에서는 아무것도 안 한다.
 */
function clickTabJs(text: string | string[]) {
  const wants = Array.isArray(text) ? text : [text];
  return `(function () {
  if (window.__tabClicked || /(^|\\.)search\\.naver\\.com$|^(m\\.)?map\\.naver\\.com$/.test(location.hostname)) return;
  window.__tabClicked = true;
  var naver = /(^|\\.)place\\.naver\\.com$/.test(location.hostname);
  function norm(s) { return String(s || "").replace(/[\\s\\d,.+()]/g, ""); }
  var wants = ${JSON.stringify(wants)}.map(norm), n = 0, clicks = 0;
  function find() {
    var best = null, bestScore = 1e9;
    var els = document.querySelectorAll('[role="tab"], a, button, span, div');
    for (var i = 0; i < els.length; i++) {
      var raw = (els[i].innerText || "").replace(/\\s+/g, " ").trim();
      if (!raw || raw.length > 40) continue;
      var tx = norm(raw);
      for (var w = 0; w < wants.length; w++) {
        var want = wants[w], extra = tx.length - want.length;
        // 정확히 같으면 우선, "인증 방문자 리뷰"처럼 앞뒤에 몇 글자 붙은 것은 그다음
        var near = tx === want ? 0 : extra > 0 && extra <= 4 && (tx.indexOf(want) === 0 || tx.slice(-want.length) === want) ? 50 : -1;
        if (near < 0) continue;
        var el = els[i].closest('[role="tab"], a, button') || els[i];
        // 탭(role=tab) > 링크·버튼 > 글자 순으로, 같으면 글자가 짧은 것
        var score = near + (el.getAttribute('role') === 'tab' ? 0 : el !== els[i] || /^(A|BUTTON)$/.test(els[i].tagName) ? 100 : 200) + raw.length;
        if (score < bestScore) { best = el; bestScore = score; }
      }
    }
    return best;
  }
  function isOn(el) {
    var a = el.getAttribute('aria-selected'), c = el.getAttribute('aria-current');
    var cls = typeof el.className === 'string' ? el.className : '';
    return a === 'true' || (c && c !== 'false') || /(^|[\\s_-])(selected|active|on|current)($|[\\s_-])/i.test(cls);
  }
  function scroll(el) { setTimeout(function () { try { el.scrollIntoView({ block: 'start' }); } catch (e) {} }, 500); }
  var t = setInterval(function () {
    n++;
    var el = find();
    if (!el) { if (n > 40) clearInterval(t); return; }
    if (!naver) { clearInterval(t); el.click(); return; }
    var a = el.tagName === 'A' ? el : el.closest('a');
    var href = a ? a.getAttribute('href') || '' : '';
    if (a && href && !/^(#|javascript:)/i.test(href)) {
      clearInterval(t);
      var u = new URL(a.href, location.href);
      if (u.pathname.replace(/\\/$/, '') === location.pathname.replace(/\\/$/, '')) return scroll(el);
      var k = 0;
      try { k = Number(sessionStorage.getItem('__tabNav') || 0); sessionStorage.setItem('__tabNav', String(k + 1)); } catch (e) {}
      if (k < 3) location.href = u.href; else el.click();
      return;
    }
    if (isOn(el)) { clearInterval(t); return scroll(el); }
    // 화면이 준비되기 전에 누르면 헛눌릴 수 있어 골라질 때까지 1.2초마다 다시
    if (clicks < 4 && n % 4 === 1) { el.click(); clicks++; }
    if (n > 40) { clearInterval(t); scroll(el); }
  }, 300);
})();
true;`;
}

const NAVER_PLACE = /^https?:\/\/(m\.)?place\.naver\.com\/(restaurant|place|cafe|hairshop|accommodation)\/(\d+)(\/home)?(\?.*)?$/;
const NAVER_PCMAP = /^https?:\/\/pcmap\.place\.naver\.com\/(restaurant|place|cafe)\/(\d+)\/home/;

/** 리뷰·블로그·사진을 앱 안에서 보여주는 웹뷰 브라우저 */
export default function WebViewModal({ target, onClose, colors: c }: { target: WebTarget | null; onClose: () => void; colors: Colors }) {
  const ref = useRef<WebViewHandle>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  /** 검색 화면에서 가게를 찾는 중 (검색 화면을 가린다) */
  const [finding, setFinding] = useState(false);

  const isPhotos = !!target && ("photos" in target || "video" in target);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    setUri(target && "url" in target ? target.url : null);
    setTitle("");
    setCanGoBack(false);
    setCurrentUrl(null);
    setLoading(true);
    setVideoFailed(false);
    const find = target && "url" in target && target.findNaverPlace;
    setFinding(!!find);
    if (!find) return;
    // 못 찾으면 검색 화면을 그대로 보여준다 (가게를 누르면 리뷰로 넘어간다)
    const t = setTimeout(() => setFinding(false), 12000);
    return () => clearTimeout(t);
  }, [target]);

  const findOpts = target && "url" in target ? target.findNaverPlace : undefined;
  const onMessage = (e: WebViewMessageEvent) => {
    if (!findOpts) return;
    try {
      const m = JSON.parse(e.nativeEvent.data) as { type?: string; id?: string | null };
      if (m.type !== "naverPlaceId") return;
      if (m.id && /^\d+$/.test(m.id)) {
        rememberNaverId(findOpts.placeId, m.id);
        setUri(naverReviewUrl(m.id, findOpts.tab, findOpts.query));
      } else setFinding(false);
    } catch {
      // 다른 메시지
    }
  };
  // 리뷰 화면에 들어가면 가림막을 걷는다
  useEffect(() => {
    if (finding && currentUrl && /place\.naver\.com\/[a-z]+\/\d+\/review/.test(currentUrl)) setFinding(false);
  }, [finding, currentUrl]);

  const close = () => onClose();

  return (
    <Modal visible={!!target} animationType="slide" onRequestClose={() => (canGoBack ? ref.current?.goBack() : close())}>
      <SafeAreaView style={{ flex: 1, backgroundColor: isPhotos ? "#000" : c.surface }} edges={["top", "bottom"]}>
        <View style={[styles.bar, { borderBottomColor: isPhotos ? "#000" : c.line }]}>
          <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="닫기" style={styles.barBtn}>
            <Text style={{ fontSize: 20, color: isPhotos ? "#fff" : c.text }}>✕</Text>
          </Pressable>
          {canGoBack && !isPhotos && (
            <Pressable onPress={() => ref.current?.goBack()} hitSlop={12} accessibilityLabel="뒤로" style={styles.barBtn}>
              <Text style={{ fontSize: 20, color: c.text }}>‹</Text>
            </Pressable>
          )}
          <Text style={[styles.title, { color: isPhotos ? "#fff" : c.text }]} numberOfLines={1}>
            {title || target?.title}
          </Text>
          {!isPhotos ? (
            <Pressable onPress={() => Linking.openURL(currentUrl ?? uri ?? "")} hitSlop={12} accessibilityLabel="외부 브라우저로 열기" style={styles.barBtn}>
              <Text style={{ fontSize: 20, color: c.muted }}>↗</Text>
            </Pressable>
          ) : (
            <View style={styles.barBtn} />
          )}
        </View>
        {target && "video" in target ? (
          <View style={{ flex: 1 }}>
            <WebView
              source={{ html: videoHtml(target.video, target.poster), baseUrl: "https://m.place.naver.com/" }}
              originWhitelist={["*"]}
              javaScriptEnabled
              allowsInlineMediaPlayback
              allowsFullscreenVideo
              mediaPlaybackRequiresUserAction={false}
              onMessage={(e: WebViewMessageEvent) => e.nativeEvent.data === "videoError" && setVideoFailed(true)}
              onLoadEnd={() => setLoading(false)}
              style={{ flex: 1, backgroundColor: "#000" }}
            />
            {videoFailed && target.fallbackUrl ? (
              <Pressable onPress={() => Linking.openURL(target.fallbackUrl!)} style={styles.videoFallback} accessibilityRole="button">
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>네이버에서 보기 ↗</Text>
              </Pressable>
            ) : null}
          </View>
        ) : target && "photos" in target ? (
          <WebView
            source={{ html: photoHtml(target.photos, target.index) }}
            originWhitelist={["*"]}
            onLoadEnd={() => setLoading(false)}
            style={{ flex: 1, backgroundColor: "#000" }}
            scalesPageToFit
          />
        ) : (
          target &&
          uri && (
            <WebView
              ref={ref}
              source={{ uri }}
              onShouldStartLoadWithRequest={(req) => {
                // 결제(네이버페이 등)·로그인 앱 호출: 웹뷰 밖 앱으로 넘긴다
                if (!/^(https?|about|data|blob):/i.test(req.url)) {
                  openExternal(req.url);
                  return false;
                }
                const toReviews = "naverToReviews" in target && target.naverToReviews;
                const toBooking = "naverToBooking" in target && target.naverToBooking;
                if (toReviews || toBooking || findOpts) {
                  const m = req.url.match(NAVER_PLACE) ?? req.url.match(NAVER_PCMAP);
                  const id = m ? (m[3] ?? m[2]) : null;
                  if (id && /^\d+$/.test(id)) {
                    if (findOpts) {
                      rememberNaverId(findOpts.placeId, id);
                      setUri(naverReviewUrl(id, findOpts.tab, findOpts.query));
                    } else setUri(toBooking ? `https://m.place.naver.com/restaurant/${id}/booking` : naverVisitorReviewUrl(id, target.title.replace(/ 방문자 리뷰$|^네이버 방문자 리뷰$/, "")));
                    return false;
                  }
                }
                return true;
              }}
              injectedJavaScript={[findOpts ? naverFindPlaceJs(findOpts.name) : "", "clickText" in target && target.clickText ? clickTabJs(target.clickText) : ""].join("\n") || undefined}
              onMessage={onMessage}
              // 네이버 로그인 유지 (예약에 필요)
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              domStorageEnabled
              javaScriptEnabled
              onNavigationStateChange={(s: WebViewNavigation) => {
                setCanGoBack(s.canGoBack);
                setCurrentUrl(s.url);
                if (s.title && !s.title.startsWith("http")) setTitle(s.title);
              }}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures
              style={{ flex: 1 }}
            />
          )
        )}
        {finding && (
          <View style={[styles.cover, { backgroundColor: c.surface }]}>
            <ActivityIndicator color={c.accent} />
            <Text style={{ marginTop: 10, fontSize: 14, color: c.muted }}>네이버에서 가게를 찾는 중…</Text>
          </View>
        )}
        {loading && !finding && (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator color={isPhotos ? "#fff" : c.accent} />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", height: 48, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  barBtn: { minWidth: 44, height: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  title: { flex: 1, fontSize: 15, fontWeight: "600", textAlign: "center" },
  loading: { position: "absolute", top: 110, left: 0, right: 0, alignItems: "center" },
  videoFallback: { position: "absolute", alignSelf: "center", bottom: 40, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  cover: { position: "absolute", top: 48, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
});
