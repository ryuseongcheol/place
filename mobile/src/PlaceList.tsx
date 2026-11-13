import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDistance } from "./PlaceDetailView";
import { useMyNotes } from "./myNotes";
import { shortArea } from "./shared";
import ShowBadges from "./ShowBadges";
import type { Colors } from "./theme";
import type { ScoredPlace } from "./types";

/** 시트 상단: 목록 제목 */
export function ListHeader({ title, subtitle, colors: c, onClose }: { title: string; subtitle?: string; colors: Colors; onClose: () => void }) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={{ fontSize: 13, color: c.muted, marginTop: 2 }} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="닫기" style={styles.close}>
        <Text style={{ fontSize: 18, color: c.muted }}>✕</Text>
      </Pressable>
    </View>
  );
}

interface Props {
  places: ScoredPlace[];
  colors: Colors;
  distanceOf: (p: ScoredPlace) => number | null;
  onPick: (p: ScoredPlace) => void;
  emptyText: string;
  numbered: boolean;
  notices?: string[];
  /** 번호 대신 ★ 배지일 때 색 (저장 리스트 색) */
  badgeColor?: (p: ScoredPlace) => string;
}

export function PlaceList({ places, colors: c, distanceOf, onPick, emptyText, numbered, notices, badgeColor }: Props) {
  const notes = useMyNotes();
  return (
    <View>
      {notices?.map((n) => (
        <Text key={n} style={[styles.notice, { backgroundColor: c.warnBg, color: c.warnText }]}>
          {n}
        </Text>
      ))}
      {places.length === 0 && <Text style={[styles.empty, { color: c.muted }]}>{emptyText}</Text>}
      {places.map((p, i) => {
        const d = distanceOf(p);
        const category = p.category.split(">").slice(-1)[0]?.trim();
        return (
          <Pressable key={p.id} onPress={() => onPick(p)} style={[styles.row, { borderBottomColor: c.line }]} accessibilityRole="button">
            <View style={[styles.badge, { backgroundColor: numbered ? c.text : (badgeColor?.(p) ?? "#F5A400") }]}>
              <Text style={{ color: numbered ? c.bg : "#fff", fontWeight: "800", fontSize: 13 }}>{numbered ? i + 1 : "★"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: c.text }} numberOfLines={1}>
                {p.name} <Text style={{ fontSize: 13, fontWeight: "400", color: c.muted }}>{category}</Text>
              </Text>
              <Text style={{ fontSize: 13, color: c.muted, marginTop: 3 }} numberOfLines={1}>
                {[
                  p.kakao?.rating != null ? `★ ${p.kakao.rating.toFixed(1)}` : null,
                  p.naver?.visitorReviewCount ? `방문자리뷰 ${p.naver.visitorReviewCount.toLocaleString()}` : null,
                  d != null ? formatDistance(d) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {/* 어느 지점인지: 동네 · 도로명, 묶인 다른 지점 수, 내 평가 */}
              <Text style={{ fontSize: 12, color: c.muted, marginTop: 2 }} numberOfLines={1}>
                {[
                  shortArea(p) || null,
                  p.otherBranches ? `다른 지점 ${p.otherBranches}곳` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {notes.get(p.id)?.rating ? <Text style={{ color: "#F5A400", fontWeight: "700" }}>{`  내 ★${notes.get(p.id)!.rating}`}</Text> : null}
                {notes.get(p.id)?.memo ? <Text>{"  📝"}</Text> : null}
                {notes.get(p.id)?.photos?.length ? <Text>{`  📷${notes.get(p.id)!.photos!.length}`}</Text> : null}
              </Text>
              <ShowBadges shows={p.shows} size="sm" />
              {numbered && (
                <Text style={{ fontSize: 13, lineHeight: 19, color: c.text, marginTop: 5 }} numberOfLines={2}>
                  {p.reason}
                </Text>
              )}
            </View>
            {numbered && <Text style={{ fontSize: 16, fontWeight: "800", color: c.accent }}>{p.score}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  title: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  close: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  badge: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  empty: { textAlign: "center", fontSize: 14, lineHeight: 22, paddingVertical: 32, paddingHorizontal: 24 },
  notice: { marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 8, fontSize: 13, lineHeight: 19, overflow: "hidden" },
});
