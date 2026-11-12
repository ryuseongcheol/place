import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView as RNWebView, type WebViewNavigation, type WebViewProps } from "react-native-webview";
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
    }
  | { title: string; photos: string[]; index: number };

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

  const isPhotos = !!target && "photos" in target;

  useEffect(() => {
    setUri(target && "url" in target ? target.url : null);
    setTitle("");
    setCanGoBack(false);
    setCurrentUrl(null);
    setLoading(true);
  }, [target]);

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
              <Text style={{ fontSize: 13, color: c.muted }}>브라우저</Text>
            </Pressable>
          ) : (
            <View style={styles.barBtn} />
          )}
        </View>
        {target && "photos" in target ? (
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
                if ("naverToReviews" in target && target.naverToReviews) {
                  const m = req.url.match(NAVER_PLACE) ?? req.url.match(NAVER_PCMAP);
                  const id = m ? (m[3] ?? m[2]) : null;
                  if (id && /^\d+$/.test(id)) {
                    setUri(`https://m.place.naver.com/restaurant/${id}/review/visitor`);
                    return false;
                  }
                }
                return true;
              }}
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
        {loading && (
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
});
