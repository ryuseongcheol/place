import { StyleSheet, Text, View } from "react-native";
import { showKind, showLabel } from "./shared";

/** 방송·유튜브·가이드 출연 배지 (📺 수요미식회, ▶ 먹을텐데, ⭐ 미쉐린) */
export default function ShowBadges({ shows, size = "md" }: { shows?: string[] | null; size?: "sm" | "md" }) {
  if (!shows?.length) return null;
  const icon = (id: string) => (showKind(id) === "guide" ? "⭐" : showKind(id) === "youtube" ? "▶" : "📺");
  return (
    <View style={styles.row}>
      {shows.map((id) => (
        <View key={id} style={[styles.badge, showKind(id) === "guide" ? styles.guide : styles.tv, size === "sm" && styles.sm]}>
          <Text style={[styles.text, showKind(id) === "guide" ? { color: "#8A5A00" } : { color: "#B42318" }, size === "sm" && { fontSize: 11 }]}>
            {icon(id)} {showLabel(id)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  sm: { paddingHorizontal: 5, paddingVertical: 2 },
  tv: { backgroundColor: "#FDE7E7" },
  guide: { backgroundColor: "#FFF1CC" },
  text: { fontSize: 12, fontWeight: "700" },
});
