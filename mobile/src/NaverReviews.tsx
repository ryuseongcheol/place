import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";
import { lookupNaverPlace } from "./naverDevice";
import { NAVER_REVIEW_EXTRACT_JS, naverVisitorReviewPage, type NaverReviewResult, type NaverVisitorReview } from "./shared";
import type { Colors } from "./theme";
import type { ScoredPlace } from "./types";
import type { WebTarget } from "./WebViewModal";

// react-native-webview 타입이 props 를 never 로 잡아서 명시 (WebViewModal 과 같은 방식)
const WebView = RNWebView as unknown as React.ComponentType<WebViewProps>;

/** 받아 온 리뷰 (네이버 장소 id 별, 30분) */
const cache = new Map<string, { at: number; reviews: NaverVisitorReview[] }>();
const TTL = 30 * 60 * 1000;

type Status = "finding" | "loading" | "done" | "failed" | "noid";

/**
 * 네이버 방문자 리뷰 본문. 공식 API가 없어서 보이지 않는 웹뷰로 리뷰 페이지를 열고
 * lib/naverReviewExtract.ts 스크립트로 리뷰를 뽑아 온다. 실패하면 위의 '보기'(네이버 페이지)로 확인.
 */
export default function NaverReviews({ place: p, colors: c, openWeb }: { place: ScoredPlace; colors: Colors; openWeb: (t: WebTarget) => void }) {
  const [naverId, setNaverId] = useState<string | null>(p.naver?.naverId ?? null);
  const [status, setStatus] = useState<Status>(p.naver?.naverId ? "loading" : "finding");
  const [reviews, setReviews] = useState<NaverVisitorReview[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 장소가 바뀌면 처음부터
  useEffect(() => {
    let alive = true;
    setReviews([]);
    setShowAll(false);
    setOpen({});
    const known = p.naver?.naverId ?? null;
    const start = (id: string | null) => {
      if (!alive) return;
      setNaverId(id);
      if (!id) return setStatus("noid");
      const hit = cache.get(id);
      if (hit && Date.now() - hit.at < TTL) {
        setReviews(hit.reviews);
        return setStatus("done");
      }
      setStatus("loading");
    };
    if (known) start(known);
    else {
      setStatus("finding");
      lookupNaverPlace(p)
        .then((info) => start(info?.id ?? null))
        .catch(() => start(null));
    }
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
      const list = r.reviews.filter((x) => x.body.trim().length > 0);
      if (naverId) cache.set(naverId, { at: Date.now(), reviews: list });
      setReviews(list);
      setStatus(list.length ? "done" : "failed");
    } catch {
      setStatus("failed");
    }
  };

  const shown = showAll ? reviews : reviews.slice(0, 5);

  return (
    <View>
      {/* 보이지 않는 웹뷰: 리뷰 페이지를 열어 리뷰만 뽑는다 */}
      {status === "loading" && naverId && (
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
      )}

      {(status === "loading" || status === "finding") && (
        <View style={styles.loading}>
          <ActivityIndicator color={c.naver} size="small" />
          <Text style={{ fontSize: 13, color: c.muted }}>네이버 방문자 리뷰 불러오는 중…</Text>
        </View>
      )}
      {status === "failed" && <Text style={[styles.note, { color: c.muted }]}>네이버 리뷰 본문을 불러오지 못했어요. 위의 '보기'로 네이버에서 확인할 수 있어요.</Text>}
      {status === "noid" && <Text style={[styles.note, { color: c.muted }]}>네이버 지도에서 이 가게를 찾지 못했어요.</Text>}

      {shown.map((r) => {
        const expanded = !!open[r.id];
        return (
          <View key={r.id} style={[styles.review, { borderBottomColor: c.line }]}>
            <Text style={{ fontSize: 12, color: c.muted }} numberOfLines={1}>
              <Text style={{ color: c.text, fontWeight: "700" }}>{r.nickname ?? "네이버 사용자"}</Text>
              {[r.visited ? ` · ${r.visited} 방문` : "", r.visitCount && r.visitCount > 1 ? ` · ${r.visitCount}번째 방문` : ""].join("")}
            </Text>
            <Pressable onPress={() => setOpen((o) => ({ ...o, [r.id]: !expanded }))} accessibilityRole="button" accessibilityLabel={expanded ? "리뷰 접기" : "리뷰 펼치기"}>
              <Text style={{ fontSize: 14, lineHeight: 21, color: c.text, marginTop: 4 }} numberOfLines={expanded ? undefined : 4}>
                {r.body}
              </Text>
            </Pressable>
            {r.photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 8 }}>
                {r.photos.map((u, i) => (
                  <Pressable key={u} onPress={() => openWeb({ title: `${p.name} 방문자 리뷰 사진`, photos: r.photos, index: i })} accessibilityLabel={`리뷰 사진 ${i + 1}`}>
                    <Image source={{ uri: u }} style={[styles.photo, { backgroundColor: c.surface2 }]} contentFit="cover" />
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {r.keywords.length > 0 && (
              <View style={styles.kws}>
                {r.keywords.map((k) => (
                  <Text key={k} style={[styles.kw, { backgroundColor: c.naverBg, color: c.naver }]}>
                    {k}
                  </Text>
                ))}
              </View>
            )}
          </View>
        );
      })}
      {status === "done" && reviews.length > 5 && !showAll && (
        <Pressable onPress={() => setShowAll(true)} style={[styles.more, { borderColor: c.line }]} accessibilityRole="button">
          <Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>네이버 리뷰 더보기 ({reviews.length - 5})</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: "absolute", left: 0, top: 0, width: 360, height: 2, opacity: 0, overflow: "hidden" },
  loading: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 },
  note: { fontSize: 12, lineHeight: 18, paddingVertical: 10 },
  review: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  photo: { width: 72, height: 72, borderRadius: 8 },
  kws: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  kw: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
  more: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center", marginTop: 10 },
});
