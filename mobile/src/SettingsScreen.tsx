import { useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { regionAtLocation, searchRegions, type RegionHit } from "./api";
import { MAX_REGIONS, useRegions } from "./regions";
import { RADII } from "./SearchPanel";
import type { Colors } from "./theme";
import { progressText } from "./TopSearch";

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: Colors;
  me: { lat: number; lng: number } | null;
  radius: number;
  setRadius: (r: number) => void;
}

export default function SettingsScreen({ visible, onClose, colors: c, me, radius, setRadius }: Props) {
  const rg = useRegions();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<RegionHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const r = await searchRegions(q.trim());
      setHits(r.regions);
      if (!r.regions.length) setError("찾는 동네가 없어요. '역삼동'처럼 동 이름으로 검색해 보세요.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색 실패");
    } finally {
      setSearching(false);
    }
  };

  const addHere = async () => {
    if (!me) return;
    setSearching(true);
    setError(null);
    try {
      const r = await regionAtLocation(me.lat, me.lng);
      if (r.regions[0]) add(r.regions[0]);
      else setError("현재 위치의 동네를 찾지 못했어요.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패");
    } finally {
      setSearching(false);
    }
  };

  const add = (hit: RegionHit) => {
    if (rg.regions.some((r) => r.id === hit.id)) {
      setToast(`'${hit.name}'은(는) 이미 선택돼 있어요.`);
      return;
    }
    const removed = rg.addRegion(hit);
    setToast(
      removed
        ? `최대 ${MAX_REGIONS}곳이라 가장 먼저 고른 '${removed.name}'을(를) 빼고 '${hit.name}'을(를) 추가했어요.`
        : `'${hit.name}'을(를) 추가했어요. 맛집 수집을 시작합니다.`,
    );
    setHits([]);
    setQ("");
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "bottom"]}>
        <View style={[styles.header, { borderBottomColor: c.line }]}>
          <Text style={[styles.h1, { color: c.text }]}>설정</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="닫기">
            <Text style={{ fontSize: 20, color: c.text }}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <Text style={[styles.h2, { color: c.text }]}>미리 수집할 지역</Text>
          <Text style={[styles.desc, { color: c.muted }]}>
            자주 가는 동네를 최대 {MAX_REGIONS}곳까지 골라두면, 그 동네 맛집을 미리 모아 주제별로 분류해 둬요. 상단에서 지역을 고르면 기다림 없이 바로 추천해요.
            {"\n"}{MAX_REGIONS}곳을 넘게 고르면 가장 먼저 고른 지역이 빠지고 새 지역이 들어가요.
          </Text>

          <View style={styles.searchRow}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="동 이름 검색 (예: 역삼동, 성수동)"
              placeholderTextColor={c.muted}
              returnKeyType="search"
              onSubmitEditing={search}
              style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.surface }]}
            />
            <Pressable style={[styles.btn, { backgroundColor: c.accent }]} onPress={search} disabled={searching}>
              {searching ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>검색</Text>}
            </Pressable>
          </View>
          <Pressable onPress={addHere} disabled={!me || searching} style={{ paddingVertical: 10 }}>
            <Text style={{ color: me ? c.accent : c.muted, fontWeight: "600" }}>📍 현재 위치 동네 추가</Text>
          </Pressable>
          {error && <Text style={{ color: c.errorText, marginBottom: 8 }}>{error}</Text>}
          {hits.map((h) => (
            <Pressable key={h.id} style={[styles.hit, { borderColor: c.line, backgroundColor: c.surface }]} onPress={() => add(h)}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: c.text }}>{h.name}</Text>
                <Text style={{ fontSize: 12, color: c.muted }}>{h.fullName}</Text>
              </View>
              <Text style={{ color: c.accent, fontWeight: "700" }}>+ 추가</Text>
            </Pressable>
          ))}
          {toast && (
            <View style={[styles.toast, { backgroundColor: c.warnBg }]}>
              <Text style={{ color: c.warnText, fontSize: 13, lineHeight: 19 }}>{toast}</Text>
            </View>
          )}

          <Text style={[styles.h3, { color: c.muted }]}>
            선택한 지역 {rg.regions.length}/{MAX_REGIONS}
          </Text>
          {rg.regions.length === 0 && <Text style={{ color: c.muted, fontSize: 13 }}>아직 선택한 지역이 없어요.</Text>}
          {rg.regions.map((r, i) => {
            const pr = rg.progress[r.id];
            const pct = pr?.phase === "done" ? 1 : pr?.target ? pr.detailed / pr.target : 0;
            return (
              <View key={r.id} style={[styles.region, { backgroundColor: c.surface, borderColor: c.line }]}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: c.text }}>
                      {r.name} {i === 0 && rg.regions.length === MAX_REGIONS && <Text style={{ fontSize: 11, color: c.muted, fontWeight: "400" }}>(다음에 빠질 지역)</Text>}
                    </Text>
                    <Text style={{ fontSize: 12, color: c.muted }}>{r.fullName} · 반경 {r.radius}m</Text>
                  </View>
                  {(pr?.phase === "listing" || pr?.phase === "detail") && <ActivityIndicator color={c.accent} />}
                </View>
                <View style={[styles.bar, { backgroundColor: c.surface2 }]}>
                  <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: pr?.phase === "error" ? c.errorText : c.accent }]} />
                </View>
                <Text style={{ fontSize: 12, color: pr?.phase === "error" ? c.errorText : c.muted, marginTop: 6 }}>
                  {progressText(pr)}
                  {pr?.doneAt ? ` · ${new Date(pr.doneAt).toLocaleDateString("ko-KR")}` : ""}
                </Text>
                <View style={styles.regionActions}>
                  <Pressable onPress={() => rg.recrawl(r.id)} hitSlop={6}>
                    <Text style={{ color: c.accent, fontSize: 13, fontWeight: "600" }}>다시 수집</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      Alert.alert("지역 삭제", `'${r.name}'과(와) 수집한 데이터를 지울까요?`, [
                        { text: "취소" },
                        { text: "삭제", style: "destructive", onPress: () => rg.removeRegion(r.id) },
                      ])
                    }
                    hitSlop={6}
                  >
                    <Text style={{ color: c.errorText, fontSize: 13, fontWeight: "600" }}>삭제</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          <Text style={[styles.desc, { color: c.muted, marginTop: 8 }]}>
            수집은 앱이 켜져 있는 동안 진행되고, 앱을 다시 켜면 이어서 해요. 지역당 최대 1,200곳의 카카오 별점·메뉴·후기와 네이버 리뷰 수·키워드 리뷰를 모아 숨은 분류값을 계산하고, 서버에 Claude 키가 있으면 AI가 한 번 더 분류해요.
          </Text>

          <Text style={[styles.h2, { color: c.text, marginTop: 28 }]}>내 주변 검색 반경</Text>
          <View style={[styles.seg, { borderColor: c.line }]}>
            {RADII.map((r, i) => {
              const on = radius === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setRadius(r)}
                  style={[styles.segBtn, { backgroundColor: on ? c.text : c.surface }, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line }]}
                >
                  <Text style={{ color: on ? c.bg : c.text, fontWeight: on ? "700" : "400" }}>{r < 1000 ? `${r}m` : `${r / 1000}km`}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, height: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  h1: { fontSize: 20, fontWeight: "800" },
  h2: { fontSize: 17, fontWeight: "800" },
  h3: { fontSize: 13, fontWeight: "700", marginTop: 18, marginBottom: 8 },
  desc: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  searchRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  btn: { borderRadius: 10, paddingHorizontal: 16, justifyContent: "center", minWidth: 64, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "800" },
  hit: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 6 },
  toast: { borderRadius: 10, padding: 10, marginTop: 8 },
  region: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  bar: { height: 6, borderRadius: 3, marginTop: 10, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  regionActions: { flexDirection: "row", gap: 18, marginTop: 10 },
  seg: { flexDirection: "row", borderWidth: 1, borderRadius: 10, overflow: "hidden", marginTop: 10, alignSelf: "flex-start" },
  segBtn: { paddingHorizontal: 16, paddingVertical: 10 },
});
