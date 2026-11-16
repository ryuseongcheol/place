import { useEffect, useState } from "react";
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ATTR_KEYS, ATTR_LABELS, DEFAULT_WEIGHTS, THEME_PRESETS, WEIGHT_PROFILES, type AttrKey } from "./shared";
import type { Colors } from "./theme";
import { useThemes, type UserTheme } from "./themes";

/** 웹 미리보기에서는 버튼 달린 알림창이 안 되므로 바로 실행 */
function confirm(title: string, msg: string, ok: string, run: () => void) {
  if (Platform.OS === "web") return run();
  Alert.alert(title, msg, [
    { text: "취소", style: "cancel" },
    { text: ok, style: "destructive", onPress: run },
  ]);
}

const splitWords = (s: string, n: number) =>
  [...new Set(s.split(/[,，\n]/).map((w) => w.trim()).filter(Boolean))].slice(0, n);

/** 분류값 칩: 누를 때마다 없음 → 중요 → 조금 → 피하기 → 없음 */
const CYCLE = [0, 1, 0.5, -0.5];
const nextWeight = (v: number | undefined) => CYCLE[(CYCLE.indexOf(v ?? 0) + 1) % CYCLE.length] ?? 0;

const sameWeights = (a: UserTheme["weights"], b: UserTheme["weights"]) =>
  Math.abs(a.rating - b.rating) + Math.abs(a.popularity - b.popularity) + Math.abs(a.relevance - b.relevance) + Math.abs(a.distance - b.distance) < 0.02;

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: Colors;
}

/** 추천 주제 편집: 순서·표시 여부, 내용 고치기, 새 주제 만들기 */
export default function ThemeEditor({ visible, onClose, colors: c }: Props) {
  const th = useThemes();
  const [editing, setEditing] = useState<UserTheme | "new" | null>(null);

  useEffect(() => {
    if (!visible) setEditing(null);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => (editing ? setEditing(null) : onClose())}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "bottom"]}>
        {editing ? (
          <ThemeForm
            key={editing === "new" ? "new" : editing.id}
            theme={editing === "new" ? null : editing}
            colors={c}
            onBack={() => setEditing(null)}
          />
        ) : (
          <>
            <View style={[styles.header, { borderBottomColor: c.line }]}>
              <Text style={[styles.h1, { color: c.text }]}>추천 주제 편집</Text>
              <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="닫기">
                <Text style={{ fontSize: 15, color: c.accent, fontWeight: "800" }}>완료</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              <Text style={[styles.desc, { color: c.muted }]}>
                화살표로 칩 순서를 바꾸고, 눈 버튼으로 숨기거나 보일 수 있어요. 주제를 누르면 이름·검색어·중요하게 볼 특징을 고칠 수 있어요.
              </Text>
              <View style={[styles.list, { backgroundColor: c.surface, borderColor: c.line }]}>
                {th.themes.map((t, i) => (
                  <View key={t.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
                    <View style={styles.arrows}>
                      <Pressable onPress={() => th.move(t.id, -1)} disabled={i === 0} hitSlop={6} accessibilityLabel={`${t.label} 위로`}>
                        <Text style={{ fontSize: 14, color: i === 0 ? c.line : c.muted }}>▲</Text>
                      </Pressable>
                      <Pressable onPress={() => th.move(t.id, 1)} disabled={i === th.themes.length - 1} hitSlop={6} accessibilityLabel={`${t.label} 아래로`}>
                        <Text style={{ fontSize: 14, color: i === th.themes.length - 1 ? c.line : c.muted }}>▼</Text>
                      </Pressable>
                    </View>
                    <Pressable onPress={() => setEditing(t)} style={{ flex: 1, paddingVertical: 12 }} accessibilityRole="button" accessibilityLabel={`${t.label} 고치기`}>
                      <Text style={{ fontSize: 15, fontWeight: "600", color: t.hidden ? c.muted : c.text }} numberOfLines={1}>
                        {t.emoji} {t.label}
                      </Text>
                      <Text style={{ fontSize: 12, color: c.muted, marginTop: 2 }} numberOfLines={1}>
                        {[!t.builtin ? "내 주제" : t.edited ? "수정됨" : null, t.hidden ? "숨김" : null, t.keywords.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => th.setHidden(t.id, !t.hidden)}
                      hitSlop={8}
                      style={[styles.eye, { borderColor: c.line, backgroundColor: t.hidden ? c.surface2 : c.surface }]}
                      accessibilityRole="button"
                      accessibilityLabel={t.hidden ? `${t.label} 보이기` : `${t.label} 숨기기`}
                    >
                      <Text style={{ fontSize: 12, color: t.hidden ? c.muted : c.text, fontWeight: "600" }}>{t.hidden ? "숨김" : "표시"}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
              <Pressable onPress={() => setEditing("new")} style={[styles.bigBtn, { backgroundColor: c.accent }]} accessibilityRole="button">
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>＋ 새 주제 만들기</Text>
              </Pressable>
              <Pressable
                onPress={() => confirm("기본 주제로 되돌리기", "고친 내용과 새로 만든 주제가 모두 지워져요.", "되돌리기", th.resetAll)}
                style={{ alignSelf: "center", marginTop: 18, padding: 6 }}
                accessibilityRole="button"
              >
                <Text style={{ color: c.muted, fontSize: 13, fontWeight: "600" }}>기본 주제로 모두 되돌리기</Text>
              </Pressable>
            </ScrollView>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function ThemeForm({ theme, colors: c, onBack }: { theme: UserTheme | null; colors: Colors; onBack: () => void }) {
  const th = useThemes();
  const [emoji, setEmoji] = useState(theme?.emoji ?? "🍽");
  const [label, setLabel] = useState(theme?.label ?? "");
  const [description, setDescription] = useState(theme?.description ?? "");
  const [keywords, setKeywords] = useState((theme?.keywords ?? []).join(", "));
  const [avoid, setAvoid] = useState((theme?.avoid ?? []).join(", "));
  const [includeCafe, setIncludeCafe] = useState(theme?.includeCafe ?? false);
  const [attrs, setAttrs] = useState<Partial<Record<AttrKey, number>>>({ ...(theme?.attrs ?? {}) });
  const initialProfile = theme ? (WEIGHT_PROFILES.find((w) => sameWeights(w.weights, theme.weights))?.id ?? "own") : "balanced";
  const [profile, setProfile] = useState(initialProfile);

  const kw = splitWords(keywords, 6);
  const hasAttr = Object.values(attrs).some((v) => v);
  const valid = label.trim().length > 0 && (kw.length > 0 || hasAttr);

  const save = () => {
    if (!valid) return;
    const weights = profile === "own" ? (theme?.weights ?? DEFAULT_WEIGHTS) : (WEIGHT_PROFILES.find((w) => w.id === profile)?.weights ?? DEFAULT_WEIGHTS);
    const cleanAttrs = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v)) as Partial<Record<AttrKey, number>>;
    th.save({
      id: theme?.id ?? `c-${Date.now().toString(36)}`,
      label: label.trim().slice(0, 20),
      emoji: emoji.trim() || "🍽",
      description: description.trim().slice(0, 100),
      keywords: kw.length ? kw : [label.trim()],
      includeCafe,
      avoid: splitWords(avoid, 10),
      attrs: cleanAttrs,
      weights,
    });
    onBack();
  };

  const base = theme?.builtin ? THEME_PRESETS.find((p) => p.id === theme.id) : null;

  return (
    <>
      <View style={[styles.header, { borderBottomColor: c.line }]}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="주제 목록으로">
          <Text style={{ fontSize: 15, color: c.text }}>‹ 목록</Text>
        </Pressable>
        <Text style={[styles.h2, { color: c.text }]}>{theme ? "주제 고치기" : "새 주제"}</Text>
        <Pressable onPress={save} disabled={!valid} hitSlop={12} accessibilityRole="button" accessibilityLabel="저장">
          <Text style={{ fontSize: 15, color: valid ? c.accent : c.muted, fontWeight: "800" }}>저장</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: c.text }]}>이름</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={emoji}
            onChangeText={(v) => setEmoji([...v].slice(-2).join(""))}
            style={[styles.input, styles.emojiInput, { color: c.text, borderColor: c.line, backgroundColor: c.surface }]}
            accessibilityLabel="이모지"
          />
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="예: 비 오는 날 파전"
            placeholderTextColor={c.muted}
            maxLength={20}
            style={[styles.input, { flex: 1, minWidth: 0, color: c.text, borderColor: c.line, backgroundColor: c.surface }]}
            accessibilityLabel="주제 이름"
          />
        </View>

        <Text style={[styles.label, { color: c.text }]}>한 줄 설명</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="예: 비 오는 날 막걸리와 전이 생각날 때"
          placeholderTextColor={c.muted}
          maxLength={100}
          style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.surface }]}
        />
        <Text style={[styles.help, { color: c.muted }]}>AI가 자유 입력과 함께 해석할 때 참고해요.</Text>

        <Text style={[styles.label, { color: c.text }]}>검색어 <Text style={{ color: c.muted, fontWeight: "400" }}>(쉼표로 구분, 최대 6개)</Text></Text>
        <TextInput
          value={keywords}
          onChangeText={setKeywords}
          placeholder="예: 파전, 막걸리, 전집, 칼국수"
          placeholderTextColor={c.muted}
          style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.surface }]}
        />
        <Text style={[styles.help, { color: c.muted }]}>내 주변 실시간 추천 때 카카오맵에서 이 단어들로 식당을 찾아요.</Text>

        <Text style={[styles.label, { color: c.text }]}>중요하게 볼 특징</Text>
        <Text style={[styles.help, { color: c.muted, marginTop: 0, marginBottom: 8 }]}>
          누를 때마다 <Text style={{ color: c.accent, fontWeight: "700" }}>중요</Text> → <Text style={{ fontWeight: "700" }}>조금</Text> →{" "}
          <Text style={{ color: c.errorText, fontWeight: "700" }}>피하기</Text> → 해제. 미리 수집한 동네와 서버 DB는 이 값으로 순위를 매겨요.
        </Text>
        <View style={styles.chips}>
          {ATTR_KEYS.map((k) => {
            const v = attrs[k] ?? 0;
            const strong = v >= 0.75, light = v > 0 && v < 0.75, neg = v < 0;
            return (
              <Pressable
                key={k}
                onPress={() => setAttrs((a) => ({ ...a, [k]: nextWeight(a[k]) }))}
                style={[
                  styles.chip,
                  {
                    borderColor: strong ? c.accent : light ? c.accent : neg ? c.errorText : c.line,
                    backgroundColor: strong ? c.accent : light ? c.accentSoft : neg ? c.errorBg : c.surface,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${ATTR_LABELS[k]}: ${strong ? "중요" : light ? "조금" : neg ? "피하기" : "해제"}`}
              >
                <Text style={{ fontSize: 13, color: strong ? "#fff" : light ? c.accent : neg ? c.errorText : c.text, fontWeight: v ? "700" : "400" }}>
                  {strong ? "★ " : neg ? "✕ " : ""}
                  {ATTR_LABELS[k]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.switchRow, { borderColor: c.line, backgroundColor: c.surface }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, color: c.text, fontWeight: "600" }}>카페도 같이 찾기</Text>
            <Text style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>디저트·브런치 같은 주제면 켜 주세요.</Text>
          </View>
          <Switch value={includeCafe} onValueChange={setIncludeCafe} trackColor={{ true: c.accent, false: c.line }} />
        </View>

        <Text style={[styles.label, { color: c.text }]}>피할 업종·단어 <Text style={{ color: c.muted, fontWeight: "400" }}>(쉼표로 구분)</Text></Text>
        <TextInput
          value={avoid}
          onChangeText={setAvoid}
          placeholder="예: 프랜차이즈, 술집"
          placeholderTextColor={c.muted}
          style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.surface }]}
        />

        <Text style={[styles.label, { color: c.text }]}>순위를 매길 때 더 중요하게</Text>
        <View style={styles.chips}>
          {[...(theme && initialProfile === "own" ? [{ id: "own", label: theme.builtin ? "기본값" : "지금 값" }] : []), ...WEIGHT_PROFILES]
            .map((w) => {
              const on = profile === w.id;
              return (
                <Pressable
                  key={w.id}
                  onPress={() => setProfile(w.id)}
                  style={[styles.chip, { borderColor: on ? c.text : c.line, backgroundColor: on ? c.text : c.surface }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={{ fontSize: 13, color: on ? c.bg : c.text, fontWeight: on ? "700" : "400" }}>{w.label}</Text>
                </Pressable>
              );
            })}
        </View>

        {!valid && <Text style={[styles.help, { color: c.errorText, marginTop: 16 }]}>이름과, 검색어나 중요하게 볼 특징 중 하나는 있어야 해요.</Text>}

        <Pressable onPress={save} disabled={!valid} style={[styles.bigBtn, { backgroundColor: c.accent, opacity: valid ? 1 : 0.5 }]} accessibilityRole="button">
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>저장</Text>
        </Pressable>
        {theme?.builtin && theme.edited && base && (
          <Pressable
            onPress={() =>
              confirm("기본값으로 되돌리기", `'${base.label}'을(를) 처음 상태로 되돌릴까요?`, "되돌리기", () => {
                th.resetOne(theme.id);
                onBack();
              })
            }
            style={{ alignSelf: "center", marginTop: 16, padding: 6 }}
            accessibilityRole="button"
          >
            <Text style={{ color: c.muted, fontWeight: "700" }}>기본값으로 되돌리기</Text>
          </Pressable>
        )}
        {theme && !theme.builtin && (
          <Pressable
            onPress={() =>
              confirm("주제 삭제", `'${theme.label}'을(를) 지울까요?`, "삭제", () => {
                th.remove(theme.id);
                onBack();
              })
            }
            style={{ alignSelf: "center", marginTop: 16, padding: 6 }}
            accessibilityRole="button"
          >
            <Text style={{ color: c.errorText, fontWeight: "700" }}>이 주제 삭제</Text>
          </Pressable>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, height: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  h1: { fontSize: 20, fontWeight: "800" },
  h2: { fontSize: 17, fontWeight: "800" },
  desc: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  list: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 },
  arrows: { gap: 4, alignItems: "center", width: 20 },
  eye: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  bigBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  label: { fontSize: 14, fontWeight: "700", marginTop: 20, marginBottom: 8 },
  help: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  emojiInput: { width: 56, textAlign: "center", fontSize: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 7 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 20 },
});
