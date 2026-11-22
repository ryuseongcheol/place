import SafeImage from "./SafeImage";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import type { NaverReviewStatus } from "./naverPlace";
import type { NaverVisitorReview } from "./shared";
import type { Colors } from "./theme";
import type { WebTarget } from "./WebViewModal";

/** 네이버 방문자 리뷰 본문 목록 (src/naverPlace.tsx 가 뽑아 온 것) */
export default function NaverReviews({
  placeName,
  status,
  reviews,
  colors: c,
  openWeb,
  diag,
  naverUrl,
}: {
  placeName: string;
  /** 동영상 주소를 못 찾았거나 재생이 안 될 때 여는 네이버 방문자 리뷰 화면 */
  naverUrl?: string | null;
  /** 못 읽었을 때 원인 찾기용 기록: 있으면 '진단 정보 보내기' */
  diag?: string | null;
  status: NaverReviewStatus;
  reviews: NaverVisitorReview[];
  colors: Colors;
  openWeb: (t: WebTarget) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setShowAll(false);
    setOpen({});
  }, [placeName]);
  const shown = showAll ? reviews : reviews.slice(0, 5);

  return (
    <View>
      {(status === "loading" || status === "finding") && (
        <View style={styles.loading}>
          <ActivityIndicator color={c.naver} size="small" />
          <Text style={{ fontSize: 13, color: c.muted }}>네이버 방문자 리뷰 불러오는 중…</Text>
        </View>
      )}
      {status === "failed" && <Text style={[styles.note, { color: c.muted }]}>네이버 리뷰 본문을 불러오지 못했어요. 위의 '방문자'를 누르면 네이버에서 볼 수 있어요.</Text>}
      {status === "noid" && <Text style={[styles.note, { color: c.muted }]}>네이버 지도에서 이 가게를 찾지 못했어요.</Text>}
      {(status === "failed" || status === "noid") && diag ? (
        <Pressable
          onPress={() => Share.share({ message: `[네이버 리뷰 진단] ${placeName}\n${diag}` }).catch(() => {})}
          hitSlop={8}
          style={{ alignSelf: "flex-start", marginTop: 6 }}
          accessibilityRole="button"
        >
          <Text style={{ fontSize: 12, color: c.muted, textDecorationLine: "underline" }}>진단 정보 보내기 (왜 안 되는지 확인용)</Text>
        </Pressable>
      ) : null}

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
            {(r.photos.length > 0 || (r.videos?.length ?? 0) > 0) && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 8 }}>
                {/* 동영상: ▶ 표시, 누르면 앱 안에서 재생 (주소를 못 찾았으면 네이버 리뷰 화면) */}
                {(r.videos ?? []).map((v, i) => (
                  <Pressable
                    key={`v${i}`}
                    onPress={() =>
                      v.url
                        ? openWeb({ title: `${placeName} 리뷰 동영상`, video: v.url, poster: v.thumbnail, fallbackUrl: naverUrl })
                        : naverUrl && openWeb({ title: "네이버 방문자 리뷰", url: naverUrl })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`리뷰 동영상 ${i + 1} 재생`}
                  >
                    <View style={[styles.photo, { backgroundColor: "#222", overflow: "hidden" }]}>
                      {v.thumbnail ? <SafeImage source={{ uri: v.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                      <View style={styles.play}>
                        <Text style={styles.playText}>▶</Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
                {r.photos.map((u, i) => (
                  <Pressable key={u} onPress={() => openWeb({ title: `${placeName} 방문자 리뷰 사진`, photos: r.photos, index: i })} accessibilityLabel={`리뷰 사진 ${i + 1}`}>
                    <SafeImage source={{ uri: u }} style={[styles.photo, { backgroundColor: c.surface2 }]} contentFit="cover" />
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
  loading: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 },
  note: { fontSize: 12, lineHeight: 18, paddingVertical: 10 },
  review: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  photo: { width: 72, height: 72, borderRadius: 8 },
  play: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  playText: { color: "#fff", fontSize: 22, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  kws: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  kw: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
  more: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center", marginTop: 10 },
});
