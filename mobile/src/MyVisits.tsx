import { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { shortDate, timeLabel, won } from "./dates";
import { peekDetail } from "./detailCache";
import { addManualPayment, removePayment, updatePayment, usePayments, type PaymentRecord } from "./payments";
import { snapOf } from "./placeSnap";
import type { Colors } from "./theme";
import type { ScoredPlace } from "./types";

const DAYS = [
  { label: "오늘", ago: 0 },
  { label: "어제", ago: 1 },
  { label: "2일 전", ago: 2 },
  { label: "3일 전", ago: 3 },
  { label: "1주 전", ago: 7 },
];

const splitMenus = (s: string) =>
  s
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** 먹은 메뉴 고르기: 가게 메뉴를 눌러 고르거나 직접 입력 (쉼표로 여러 개) */
function MenuPicker({ value, onChange, suggestions, colors: c }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[]; colors: Colors }) {
  const [text, setText] = useState("");
  const toggle = (m: string) => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m]);
  const addTyped = () => {
    const add = splitMenus(text).filter((m) => !value.includes(m));
    if (add.length) onChange([...value, ...add].slice(0, 10));
    setText("");
  };
  const extra = value.filter((m) => !suggestions.includes(m));
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ fontSize: 12, color: c.muted, marginBottom: 6 }}>먹은 메뉴 (선택)</Text>
      {(suggestions.length > 0 || extra.length > 0) && (
        <View style={styles.chips}>
          {[...suggestions.slice(0, 12), ...extra].map((m) => {
            const on = value.includes(m);
            return (
              <Pressable
                key={m}
                onPress={() => toggle(m)}
                style={[styles.chip, { borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accentSoft : c.surface }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={{ fontSize: 12, color: on ? c.accent : c.text, fontWeight: on ? "700" : "400" }}>
                  {on ? "✓ " : ""}
                  {m}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={addTyped}
          onBlur={addTyped}
          returnKeyType="done"
          placeholder={suggestions.length ? "목록에 없으면 직접 입력 (쉼표로 여러 개)" : "예: 순대국, 모듬순대"}
          placeholderTextColor={c.muted}
          style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.bg }]}
        />
        {!!text.trim() && (
          <Pressable onPress={addTyped} style={[styles.btn, { backgroundColor: c.surface2 }]} accessibilityRole="button">
            <Text style={{ color: c.text, fontWeight: "700" }}>추가</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** 상세 화면: 이 식당 방문·결제 기록 (결제 알림으로 자동, 또는 직접 추가). 방문마다 먹은 메뉴를 남길 수 있다 */
export default function MyVisits({ place: p, colors: c }: { place: ScoredPlace; colors: Colors }) {
  const { forPlace } = usePayments();
  const visits = forPlace(p.id);
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [ago, setAgo] = useState(0);
  const [menus, setMenus] = useState<string[]>([]);
  /** 메뉴를 고치는 중인 방문 */
  const [editing, setEditing] = useState<{ id: string; menus: string[] } | null>(null);

  // 가게 메뉴 이름 (상세에서 이미 받아 둔 것) + 예전에 이 가게에서 남긴 메뉴
  const shopMenus = (peekDetail(p.id)?.menus ?? []).map((m) => m.name.trim()).filter(Boolean);
  const pastMenus = visits.flatMap((v) => v.menus ?? []);
  const suggestions = [...new Set([...pastMenus, ...shopMenus])];

  const valid = visits.filter((v) => !v.canceled);
  const total = valid.reduce((s, v) => s + v.amount, 0);

  const save = async () => {
    const n = Number(amount.replace(/[^0-9]/g, ""));
    const d = new Date();
    d.setDate(d.getDate() - ago);
    if (ago > 0) d.setHours(12, 0, 0, 0);
    await addManualPayment(snapOf(p), Number.isFinite(n) ? n : 0, d.getTime(), menus);
    setAdding(false);
    setAmount("");
    setAgo(0);
    setMenus([]);
  };

  const saveMenus = async () => {
    if (!editing) return;
    await updatePayment(editing.id, { menus: editing.menus.length ? editing.menus : undefined });
    setEditing(null);
  };

  const askRemove = (id: string, manual?: boolean) => {
    const run = () => (manual ? removePayment(id) : updatePayment(id, { hidden: true }));
    if (Platform.OS === "web") return run();
    Alert.alert("방문 기록 삭제", "이 기록을 타임라인에서 지울까요?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: run },
    ]);
  };

  // (안쪽 컴포넌트로 만들면 다시 그릴 때마다 입력칸이 새로 생겨 글자·포커스가 사라지므로 함수로 그린다)
  const renderRow = (v: PaymentRecord) => {
    const isEditing = editing?.id === v.id;
    return (
      <View key={v.id} style={[styles.rowWrap, { borderTopColor: c.line }]}>
        <View style={styles.row}>
          <Pressable
            style={{ flex: 1 }}
            onPress={() => setEditing(isEditing ? null : { id: v.id, menus: v.menus ?? [] })}
            accessibilityRole="button"
            accessibilityLabel={`${shortDate(v.at)} 방문 메뉴 ${v.menus?.length ? "고치기" : "추가"}`}
          >
            <Text style={{ fontSize: 13, color: v.canceled ? c.muted : c.text, textDecorationLine: v.canceled ? "line-through" : "none" }}>
              {shortDate(v.at)} {v.manual ? "" : timeLabel(v.at)}
              {v.amount ? `  ${won(v.amount)}` : ""}
              <Text style={{ color: c.muted }}>{`  ${v.sources.join(" · ")}`}</Text>
              {v.canceled ? <Text style={{ color: c.errorText }}>{"  취소됨"}</Text> : null}
            </Text>
            <Text style={{ fontSize: 12, color: v.menus?.length ? c.text : c.muted, marginTop: 3 }} numberOfLines={2}>
              {v.menus?.length ? `🍽 ${v.menus.join(", ")}` : isEditing ? "" : "＋ 메뉴 남기기"}
            </Text>
          </Pressable>
          <Pressable onPress={() => askRemove(v.id, v.manual)} hitSlop={10} accessibilityLabel="방문 기록 삭제">
            <Text style={{ color: c.muted, fontSize: 13 }}>✕</Text>
          </Pressable>
        </View>
        {isEditing && (
          <View style={{ paddingBottom: 6 }}>
            <MenuPicker value={editing.menus} onChange={(m) => setEditing({ id: v.id, menus: m })} suggestions={suggestions} colors={c} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
              <Pressable onPress={() => setEditing(null)} style={[styles.btn, styles.btnPad, { backgroundColor: c.surface2 }]}>
                <Text style={{ color: c.text }}>취소</Text>
              </Pressable>
              <Pressable onPress={saveMenus} style={[styles.btn, styles.btnPad, { backgroundColor: c.accent }]} accessibilityRole="button">
                <Text style={{ color: "#fff", fontWeight: "800" }}>메뉴 저장</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.box, { borderColor: c.line, backgroundColor: c.surface }]}>
      <View style={styles.head}>
        <Text style={{ fontSize: 14, fontWeight: "800", color: c.text }}>
          내 방문 기록{valid.length ? ` ${valid.length}회` : ""}
        </Text>
        {total > 0 && <Text style={{ fontSize: 12, color: c.muted }}>총 {won(total)}</Text>}
      </View>
      {visits.length === 0 && !adding && (
        <Text style={{ fontSize: 13, color: c.muted, marginTop: 6, lineHeight: 19 }}>
          결제 알림 기록을 켜 두면 여기서 결제하는 순간 자동으로 남아요. 직접 추가할 수도 있어요.
        </Text>
      )}
      {visits.map(renderRow)}
      {adding ? (
        <View style={{ marginTop: 10 }}>
          <View style={styles.chips}>
            {DAYS.map((d) => (
              <Pressable
                key={d.ago}
                onPress={() => setAgo(d.ago)}
                style={[styles.chip, { borderColor: ago === d.ago ? c.text : c.line, backgroundColor: ago === d.ago ? c.text : c.surface }]}
              >
                <Text style={{ fontSize: 12, color: ago === d.ago ? c.bg : c.text, fontWeight: ago === d.ago ? "700" : "400" }}>{d.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="금액 (선택)"
            placeholderTextColor={c.muted}
            keyboardType="number-pad"
            style={[styles.input, { flex: 0, marginTop: 8, color: c.text, borderColor: c.line, backgroundColor: c.bg }]}
          />
          <MenuPicker value={menus} onChange={setMenus} suggestions={suggestions} colors={c} />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
            <Pressable onPress={() => setAdding(false)} style={[styles.btn, styles.btnPad, { backgroundColor: c.surface2 }]}>
              <Text style={{ color: c.text }}>취소</Text>
            </Pressable>
            <Pressable onPress={save} style={[styles.btn, styles.btnPad, { backgroundColor: c.accent }]} accessibilityRole="button">
              <Text style={{ color: "#fff", fontWeight: "800" }}>저장</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setAdding(true)} style={[styles.add, { borderColor: c.line }]} accessibilityRole="button">
          <Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>＋ 방문 기록 추가</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowWrap: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  input: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  btn: { borderRadius: 8, paddingHorizontal: 14, justifyContent: "center" },
  btnPad: { paddingVertical: 9 },
  add: { borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center", marginTop: 10 },
});
