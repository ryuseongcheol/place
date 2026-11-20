import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
type PresetChip = { id: string; label: string; emoji: string };
import RadiusSlider from "./RadiusSlider";
import type { Colors } from "./theme";
import type { LocState } from "./useLocation";


interface Props {
  colors: Colors;
  loc: LocState;
  onRelocate: () => void;
  presets: PresetChip[];
  /** 고른 주제 (여러 개) */
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** 주제 편집 화면 열기 */
  onEditThemes: () => void;
  text: string;
  setText: (t: string) => void;
  radius: number;
  setRadius: (r: number) => void;
  aiEnabled: boolean;
  loading: boolean;
  error: string | null;
  serverError: string | null;
  onRetryServer: () => void;
  onSubmit: () => void;
  /** 검색 범위 표시 (내 주변 / 미리 수집한 지역) */
  sourceLabel?: string;
  /** 닫을 수 있는지 (앱 첫 실행처럼 아직 결과가 없어도 지도는 볼 수 있게 항상 허용) */
  onClose: () => void;
}

/** 지도 위에 뜨는 "맛집 추천받기" 팝업 */
export default function SearchPanel(p: Props) {
  const c = p.colors;
  const insets = useSafeAreaInsets();
  const canSearch = p.loc.status !== "locating" && !p.loading && (p.selectedIds.length > 0 || p.text.trim().length > 0);
  const picked = p.presets.filter((t) => p.selectedIds.includes(t.id));

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={p.onClose} accessibilityLabel="팝업 닫기" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.center} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: c.surface, marginTop: insets.top + 12, marginBottom: insets.bottom + 12 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18 }} bounces={false}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: c.text }]}>
                어떤 <Text style={{ color: c.accent }}>맛집</Text>을 찾으세요?
              </Text>
              <Pressable onPress={p.onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="닫기">
                <Text style={{ fontSize: 20, color: c.muted }}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.locRow}>
              <View style={[styles.dot, { backgroundColor: p.loc.status === "ok" ? c.naver : c.muted }]} />
              <Text style={[styles.locText, { color: c.muted }]} numberOfLines={1}>
                {p.sourceLabel && !p.sourceLabel.startsWith("내 주변")
                  ? `검색 범위: ${p.sourceLabel}`
                  : p.loc.status === "locating"
                    ? "현재 위치 확인 중…"
                    : p.loc.status === "ok"
                      ? "현재 위치 기준"
                      : "강남역 기준 (위치 권한 없음)"}
              </Text>
              <Pressable onPress={p.onRelocate} disabled={p.loc.status === "locating"} hitSlop={8}>
                <Text style={{ fontSize: 13, color: c.accent, fontWeight: "600" }}>위치 다시 찾기</Text>
              </Pressable>
            </View>

            {p.serverError && (
              <Pressable onPress={p.onRetryServer} style={[styles.notice, { backgroundColor: c.errorBg }]}>
                <Text style={{ color: c.errorText, fontSize: 13, lineHeight: 19 }}>{p.serverError}{"\n"}눌러서 다시 시도</Text>
              </Pressable>
            )}

            <View style={styles.chipHead}>
              <Text style={{ flex: 1, fontSize: 12, color: c.muted }}>
                {picked.length >= 2 ? `${picked.length}개 주제를 모두 만족하는 곳을 찾아요` : "주제 · 여러 개 고를 수 있어요"}
              </Text>
              {picked.length > 0 && (
                <Pressable onPress={() => picked.forEach((t) => p.onToggle(t.id))} hitSlop={8} accessibilityRole="button">
                  <Text style={{ fontSize: 12, color: c.muted, fontWeight: "600" }}>선택 해제</Text>
                </Pressable>
              )}
              <Pressable onPress={p.onEditThemes} hitSlop={8} accessibilityRole="button" accessibilityLabel="주제 편집">
                <Text style={{ fontSize: 13, color: c.accent, fontWeight: "700" }}>✎ 편집</Text>
              </Pressable>
            </View>
            <View style={styles.chips}>
              {p.presets.map((t) => {
                const on = p.selectedIds.includes(t.id);
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => p.onToggle(t.id)}
                    style={[styles.chip, { borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accentSoft : c.surface }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={{ fontSize: 14, color: on ? c.accent : c.text, fontWeight: on ? "700" : "400" }}>
                      {on ? "✓ " : ""}
                      {t.emoji} {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              style={[styles.input, { borderColor: c.line, color: c.text, backgroundColor: c.bg }]}
              value={p.text}
              onChangeText={p.setText}
              placeholder={p.aiEnabled ? "자유롭게: 비 오는 날 혼자 먹을 따뜻한 국물" : "검색어: 국밥, 파스타…"}
              placeholderTextColor={c.muted}
              maxLength={200}
              returnKeyType="search"
              onSubmitEditing={() => canSearch && p.onSubmit()}
            />

            <View style={styles.radiusRow}>
              <Text style={[styles.radiusLabel, { color: c.muted }]}>검색 반경</Text>
              <View style={{ flex: 1 }}>
                <RadiusSlider value={p.radius} onChange={p.setRadius} colors={c} compact />
              </View>
            </View>
            <View style={styles.actionRow}>
              <Pressable
                style={[styles.primary, { backgroundColor: c.accent, opacity: canSearch ? 1 : 0.5 }]}
                onPress={p.onSubmit}
                disabled={!canSearch}
                accessibilityRole="button"
              >
                {p.loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>추천 받기</Text>}
              </Pressable>
            </View>
            {p.loading && <Text style={[styles.hint, { color: c.muted }]}>카카오맵·네이버지도 리뷰를 모아서 분석하고 있어요…</Text>}
            {!p.loading && !p.selectedIds.length && !p.text.trim() && (
              <Text style={[styles.hint, { color: c.muted }]}>주제를 고르거나(여러 개 가능) 원하는 걸 입력하세요.</Text>
            )}
            {p.error && (
              <View style={[styles.notice, { backgroundColor: c.errorBg }]}>
                <Text style={{ color: c.errorText, fontSize: 13, lineHeight: 19 }}>{p.error}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.35)" },
  center: { flex: 1, justifyContent: "center", paddingHorizontal: 14 },
  card: { borderRadius: 20, maxHeight: "92%", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 16, elevation: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 21, fontWeight: "800", letterSpacing: -0.4 },
  locRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  locText: { flex: 1, fontSize: 13 },
  chipHead: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, minHeight: 38, justifyContent: "center" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginTop: 14 },
  radiusRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  radiusLabel: { fontSize: 13 },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  primary: { flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 46 },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  hint: { fontSize: 12, marginTop: 10 },
  notice: { borderRadius: 10, padding: 10, marginTop: 12 },
});
