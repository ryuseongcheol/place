import { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { shortDate, timeLabel, won } from "./dates";
import { addManualPayment, removePayment, updatePayment, usePayments } from "./payments";
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

/** 상세 화면: 이 식당 방문·결제 기록 (결제 알림으로 자동, 또는 직접 추가) */
export default function MyVisits({ place: p, colors: c }: { place: ScoredPlace; colors: Colors }) {
  const { forPlace } = usePayments();
  const visits = forPlace(p.id);
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [ago, setAgo] = useState(0);

  const valid = visits.filter((v) => !v.canceled);
  const total = valid.reduce((s, v) => s + v.amount, 0);

  const save = async () => {
    const n = Number(amount.replace(/[^0-9]/g, ""));
    const d = new Date();
    d.setDate(d.getDate() - ago);
    if (ago > 0) d.setHours(12, 0, 0, 0);
    await addManualPayment(snapOf(p), Number.isFinite(n) ? n : 0, d.getTime());
    setAdding(false);
    setAmount("");
    setAgo(0);
  };

  const askRemove = (id: string, manual?: boolean) => {
    const run = () => (manual ? removePayment(id) : updatePayment(id, { hidden: true }));
    if (Platform.OS === "web") return run();
    Alert.alert("방문 기록 삭제", "이 기록을 타임라인에서 지울까요?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: run },
    ]);
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
      {visits.map((v) => (
        <View key={v.id} style={[styles.row, { borderTopColor: c.line }]}>
          <Text style={{ flex: 1, fontSize: 13, color: v.canceled ? c.muted : c.text, textDecorationLine: v.canceled ? "line-through" : "none" }}>
            {shortDate(v.at)} {v.manual ? "" : timeLabel(v.at)}
            {v.amount ? `  ${won(v.amount)}` : ""}
            <Text style={{ color: c.muted }}>{`  ${v.sources.join(" · ")}`}</Text>
            {v.canceled ? <Text style={{ color: c.errorText }}>{"  취소됨"}</Text> : null}
          </Text>
          <Pressable onPress={() => askRemove(v.id, v.manual)} hitSlop={10} accessibilityLabel="방문 기록 삭제">
            <Text style={{ color: c.muted, fontSize: 13 }}>✕</Text>
          </Pressable>
        </View>
      ))}
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
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="금액 (선택)"
              placeholderTextColor={c.muted}
              keyboardType="number-pad"
              style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.bg }]}
            />
            <Pressable onPress={save} style={[styles.btn, { backgroundColor: c.accent }]} accessibilityRole="button">
              <Text style={{ color: "#fff", fontWeight: "800" }}>저장</Text>
            </Pressable>
            <Pressable onPress={() => setAdding(false)} style={[styles.btn, { backgroundColor: c.surface2 }]}>
              <Text style={{ color: c.text }}>취소</Text>
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
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  btn: { borderRadius: 8, paddingHorizontal: 14, justifyContent: "center" },
  add: { borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center", marginTop: 10 },
});
