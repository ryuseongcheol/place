import { useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView as RNWebView, type WebViewNavigation, type WebViewProps } from "react-native-webview";
import type { Colors } from "./theme";

// react-native-webview 타입 정의가 제네릭 기본값(undefined) 때문에 props가 never로 잡혀서 명시적으로 지정
interface WebViewHandle {
  goBack: () => void;
}
const WebView = RNWebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebViewHandle> }>;

export interface WebTarget {
  url: string;
  title: string;
}

/** 리뷰·블로그를 앱 안에서 보여주는 웹뷰 브라우저 */
export default function WebViewModal({ target, onClose, colors: c }: { target: WebTarget | null; onClose: () => void; colors: Colors }) {
  const ref = useRef<WebViewHandle>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);

  const close = () => {
    setCanGoBack(false);
    setTitle("");
    setCurrentUrl(null);
    onClose();
  };

  return (
    <Modal visible={!!target} animationType="slide" onRequestClose={() => (canGoBack ? ref.current?.goBack() : close())}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }} edges={["top", "bottom"]}>
        <View style={[styles.bar, { borderBottomColor: c.line }]}>
          <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="닫기" style={styles.barBtn}>
            <Text style={{ fontSize: 20, color: c.text }}>✕</Text>
          </Pressable>
          {canGoBack && (
            <Pressable onPress={() => ref.current?.goBack()} hitSlop={12} accessibilityLabel="뒤로" style={styles.barBtn}>
              <Text style={{ fontSize: 20, color: c.text }}>‹</Text>
            </Pressable>
          )}
          <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
            {title || target?.title}
          </Text>
          <Pressable
            onPress={() => Linking.openURL(currentUrl ?? target?.url ?? "")}
            hitSlop={12}
            accessibilityLabel="외부 브라우저로 열기"
            style={styles.barBtn}
          >
            <Text style={{ fontSize: 13, color: c.muted }}>브라우저</Text>
          </Pressable>
        </View>
        {target && (
          <WebView
            ref={ref}
            source={{ uri: target.url }}
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
        )}
        {loading && (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator color={c.accent} />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", height: 48, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  barBtn: { minWidth: 36, height: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  title: { flex: 1, fontSize: 15, fontWeight: "600", textAlign: "center" },
  loading: { position: "absolute", top: 110, left: 0, right: 0, alignItems: "center" },
});
