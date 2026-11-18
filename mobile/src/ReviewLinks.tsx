import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Colors } from "./theme";

/** 서비스 표시 (로고 대신 글자·아이콘 배지) */
export type Badge = { kind: "naver" } | { kind: "kakao" } | { kind: "google" } | { kind: "naverBlog" };

function BadgeIcon({ badge, size = 18 }: { badge: Badge; size?: number }) {
  const r = Math.round(size * 0.24);
  if (badge.kind === "kakao")
    return (
      <View style={[styles.badge, { width: size, height: size, borderRadius: r, backgroundColor: "#FEE500" }]}>
        <MaterialCommunityIcons name="map-marker" size={Math.round(size * 0.75)} color="#3A1D1D" />
      </View>
    );
  if (badge.kind === "google")
    return (
      <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DADCE0" }]}>
        <Text style={{ fontSize: Math.round(size * 0.62), fontWeight: "800", color: "#4285F4" }}>G</Text>
      </View>
    );
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: r, backgroundColor: "#03C75A" }]}>
      <Text style={{ fontSize: Math.round(size * 0.62), fontWeight: "900", color: "#FFFFFF" }}>N</Text>
    </View>
  );
}

const fmt = (n: number) => (n >= 100000 ? `${Math.round(n / 10000)}만` : n.toLocaleString());

export interface ReviewTile {
  key: string;
  badge: Badge;
  label: string;
  count: number | null;
  rating: number | null;
  /** 아직 숫자를 불러오는 중 */
  loading?: boolean;
  onPress: () => void;
}

/** 리뷰 출처 4칸: 네이버 방문자 · 카카오 후기 · 구글 리뷰 · 네이버 블로그 (누르면 각 리뷰 화면) */
export function ReviewTiles({ tiles, colors: c }: { tiles: ReviewTile[]; colors: Colors }) {
  return (
    <View style={styles.tiles}>
      {tiles.map((t) => (
        <Pressable
          key={t.key}
          onPress={t.onPress}
          style={({ pressed }) => [styles.tile, { borderColor: c.line, backgroundColor: pressed ? c.surface2 : c.surface }]}
          accessibilityRole="link"
          accessibilityLabel={`${t.label} ${t.count != null ? `${t.count}개` : ""} ${t.rating != null ? `별점 ${t.rating}` : ""} 보기`}
        >
          <View style={styles.tileHead}>
            <BadgeIcon badge={t.badge} />
            <Text style={{ flexShrink: 1, fontSize: 12, fontWeight: "700", color: c.text }} numberOfLines={1}>
              {t.label}
            </Text>
          </View>
          <Text style={[styles.chev, { color: c.muted }]}>›</Text>
          {t.loading && t.count == null ? (
            <ActivityIndicator size="small" color={c.muted} style={{ alignSelf: "flex-start", marginTop: 6, height: 24 }} />
          ) : (
            <Text style={{ fontSize: 19, fontWeight: "800", color: c.text, marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit>
              {t.count != null ? fmt(t.count) : "—"}
            </Text>
          )}
          <Text style={{ fontSize: 12, color: t.rating != null ? c.text : c.muted, marginTop: 2 }}>
            {t.rating != null ? (
              <>
                <Text style={{ color: "#F5A400" }}>★</Text> {t.rating.toFixed(1)}
              </>
            ) : (
              "—"
            )}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** 네이버 예약 (예약을 받는 곳에만) */
export function NaverBookingRow({ onPress, colors: c }: { onPress: () => void; colors: Colors }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.booking, { borderColor: c.line, backgroundColor: pressed ? c.surface2 : c.surface }]}
      accessibilityRole="link"
      accessibilityLabel="네이버 예약"
    >
      <BadgeIcon badge={{ kind: "naver" }} size={30} />
      <Text style={{ flex: 1, fontSize: 15, fontWeight: "800", color: c.text }}>네이버 예약</Text>
      <Text style={{ fontSize: 18, color: c.muted }}>→</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", justifyContent: "center" },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 12, paddingLeft: 8, paddingRight: 14, paddingVertical: 10 },
  chev: { position: "absolute", right: 6, top: "50%", marginTop: -2, fontSize: 16 },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 5 },
  booking: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, marginHorizontal: 16, marginTop: 12 },
});
