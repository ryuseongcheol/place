import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PresetChip } from "./api";
import type { Colors } from "./theme";
import type { LocState } from "./useLocation";

export const RADII = [500, 1000, 2000, 3000];

interface Props {
  colors: Colors;
  loc: LocState;
  onRelocate: () => void;
  presets: PresetChip[];
  presetId: string | null;
  setPresetId: (id: string | null) => void;
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
  /** 닫을 수 있는지 (앱 첫 실행처럼 아직 결과가 없어도 지도는 볼 수 있게 항상 허용) */
  onClose: () => void;
}

/** 지도 위에 뜨는 "맛집 추천받기" 팝업 */
export default function SearchPanel(p: Props) {
  const c = p.colors;
  const insets = useSafeAreaInsets();
  const canSearch = p.loc.status !== "locating" && !p.loading && (p.presetId !== null || p.text.trim().length > 0);

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
                {p.loc.status === "locating" ? "현재 위치 확인 중…" : p.loc.status === "ok" ? "현재 위치 기준" : "강남역 기준 (위치 권한 없음)"}
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

            <View style={styles.chips}>
              {p.presets.map((t) => {
                const on = p.presetId === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => p.setPresetId(on ? null : t.id)}
                    style={[styles.chip, { borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accentSoft : c.surface }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={{ fontSize: 14, color: on ? c.accent : c.text, fontWeight: on ? "700" : "400" }}>
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

            <View style={styles.actionRow}>
              <View style={[styles.seg, { borderColor: c.line }]}>
                {RADII.map((r, i) => {
                  const on = p.radius === r;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => p.setRadius(r)}
                      style={[styles.segBtn, { backgroundColor: on ? c.text : c.surface }, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line }]}
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={{ fontSize: 13, color: on ? c.bg : c.text, fontWeight: on ? "700" : "400" }}>{r < 1000 ? `${r}m` : `${r / 1000}km`}</Text>
                    </Pressable>
                  );
                })}
              </View>
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
            {!p.loading && !p.presetId && !p.text.trim() && (
              <Text style={[styles.hint, { color: c.muted }]}>테마를 고르거나 원하는 걸 입력하세요.</Text>
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, minHeight: 38, justifyContent: "center" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginTop: 14 },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  seg: { flexDirection: "row", borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  segBtn: { paddingHorizontal: 11, minHeight: 46, justifyContent: "center" },
  primary: { flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 46 },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  hint: { fontSize: 12, marginTop: 10 },
  notice: { borderRadius: 10, padding: 10, marginTop: 12 },
});
