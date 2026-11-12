import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GROUP_COLORS, colorHex, useFavorites, type FavGroup, type GroupColor } from "./favorites";
import type { Colors } from "./theme";
import type { ScoredPlace } from "./types";

/** 색 고르기 */
export function ColorPicker({ value, onChange }: { value: GroupColor; onChange: (c: GroupColor) => void }) {
  return (
    <View style={styles.colors}>
      {GROUP_COLORS.map((g) => (
        <Pressable
          key={g.symbol}
          onPress={() => onChange(g.symbol)}
          style={[styles.swatch, { backgroundColor: g.hex }, value === g.symbol && styles.swatchOn]}
          accessibilityLabel={`${g.symbol} 색`}
          accessibilityState={{ selected: value === g.symbol }}
        />
      ))}
    </View>
  );
}

/** 리스트 이름·색 편집 (새로 만들기 / 수정) */
export function GroupEditor({
  visible,
  group,
  onClose,
  colors: c,
}: {
  visible: boolean;
  group: FavGroup | null; // null이면 새로 만들기
  onClose: (createdId?: string) => void;
  colors: Colors;
}) {
  const fav = useFavorites();
  const [name, setName] = useState("");
  const [color, setColor] = useState<GroupColor>("yellow");
  useEffect(() => {
    if (visible) {
      setName(group?.name ?? "");
      setColor(group?.color ?? GROUP_COLORS[(fav.groups.length + 1) % GROUP_COLORS.length].symbol);
    }
  }, [visible, group, fav.groups.length]);

  const submit = () => {
    if (!name.trim()) return;
    if (group) {
      fav.updateGroup(group.id, { name: name.trim(), color });
      onClose();
    } else onClose(fav.createGroup(name, color));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onClose()}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.center}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => onClose()} />
        <View style={[styles.dialog, { backgroundColor: c.surface }]}>
          <Text style={[styles.title, { color: c.text }]}>{group ? "리스트 편집" : "새 리스트"}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="리스트 이름 (예: 회사 근처 점심)"
            placeholderTextColor={c.muted}
            maxLength={20}
            autoFocus
            style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.bg }]}
            onSubmitEditing={submit}
          />
          <ColorPicker value={color} onChange={setColor} />
          <View style={styles.row}>
            <Pressable style={[styles.btn, { borderColor: c.line }]} onPress={() => onClose()}>
              <Text style={{ color: c.text }}>취소</Text>
            </Pressable>
            <Pressable style={[styles.btn, { backgroundColor: c.accent, borderColor: c.accent, opacity: name.trim() ? 1 : 0.5 }]} onPress={submit}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>{group ? "저장" : "만들기"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** 식당 저장: 넣을 리스트 고르기 (여러 개 가능) */
export default function SaveSheet({ place, onClose, colors: c }: { place: ScoredPlace | null; onClose: () => void; colors: Colors }) {
  const fav = useFavorites();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (place) {
      const current = fav.groupsOf(place.id);
      setSelected(current.length ? current : []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.id]);

  if (!place) return null;
  const wasSaved = fav.isFavorite(place.id);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const done = () => {
    fav.setPlaceGroups(place, selected);
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.35)" }]} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.sheetHead}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: c.text }]}>저장할 리스트</Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
              {place.name}
            </Text>
          </View>
          <Pressable onPress={() => setCreating(true)} hitSlop={8}>
            <Text style={{ color: c.accent, fontWeight: "700" }}>+ 새 리스트</Text>
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: 360 }}>
          {fav.groups.map((g) => {
            const on = selected.includes(g.id);
            const count = fav.items.filter((it) => it.groupIds.includes(g.id)).length;
            return (
              <Pressable key={g.id} style={[styles.groupRow, { borderBottomColor: c.line }]} onPress={() => toggle(g.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <View style={[styles.dot, { backgroundColor: colorHex(g.color) }]} />
                <Text style={{ flex: 1, fontSize: 16, color: c.text }}>{g.name}</Text>
                <Text style={{ color: c.muted, marginRight: 12 }}>{count}</Text>
                <View style={[styles.check, { borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accent : "transparent" }]}>
                  {on && <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>✓</Text>}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={[styles.row, { marginHorizontal: 16 }]}>
          {wasSaved && (
            <Pressable
              style={[styles.btn, { borderColor: c.line }]}
              onPress={() =>
                Alert.alert("저장 취소", `'${place.name}'을(를) 모든 리스트에서 뺄까요?`, [
                  { text: "아니요" },
                  { text: "빼기", style: "destructive", onPress: () => (fav.setPlaceGroups(place, []), onClose()) },
                ])
              }
            >
              <Text style={{ color: c.errorText }}>저장 취소</Text>
            </Pressable>
          )}
          <Pressable style={[styles.btn, { backgroundColor: c.accent, borderColor: c.accent, flex: 2 }]} onPress={done}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>{selected.length ? `${selected.length}개 리스트에 저장` : wasSaved ? "저장 취소" : "닫기"}</Text>
          </Pressable>
        </View>
      </View>
      <GroupEditor
        visible={creating}
        group={null}
        colors={c}
        onClose={(id) => {
          setCreating(false);
          if (id) setSelected((s) => [...s, id]);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.35)" },
  dialog: { borderRadius: 16, padding: 18 },
  title: { fontSize: 18, fontWeight: "800" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginTop: 14 },
  colors: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  swatchOn: { borderWidth: 3, borderColor: "#fff", shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 3, elevation: 3 },
  row: { flexDirection: "row", gap: 10, marginTop: 16 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 16 },
  sheetHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10 },
  groupRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
