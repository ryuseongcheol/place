import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { DEFAULT_GROUP_ID, colorHex, useFavorites, type FavGroup } from "./favorites";
import type { Colors } from "./theme";

/** 시트 상단: 저장 리스트 목록 제목 */
export function FavGroupsHeader({
  colors: c,
  editing,
  setEditing,
  onNew,
  onClose,
}: {
  colors: Colors;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const fav = useFavorites();
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: c.text }]}>저장 리스트</Text>
        <Text style={{ fontSize: 13, color: c.muted, marginTop: 2 }}>
          {fav.groups.length}개 리스트 · {fav.items.length}곳
        </Text>
      </View>
      <Pressable onPress={onNew} hitSlop={8} style={styles.headBtn}>
        <Text style={{ color: c.accent, fontWeight: "700" }}>+ 새 리스트</Text>
      </Pressable>
      <Pressable onPress={() => setEditing(!editing)} hitSlop={8} style={styles.headBtn}>
        <Text style={{ color: c.text, fontWeight: "600" }}>{editing ? "완료" : "편집"}</Text>
      </Pressable>
      <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="닫기" style={styles.headBtn}>
        <Text style={{ fontSize: 18, color: c.muted }}>✕</Text>
      </Pressable>
    </View>
  );
}

/** 저장 리스트 목록 (네이버 지도 저장 리스트처럼 색·이름·개수) */
export function FavGroupsList({
  colors: c,
  editing,
  onOpen,
  onEdit,
}: {
  colors: Colors;
  editing: boolean;
  onOpen: (groupId: string | null) => void;
  onEdit: (g: FavGroup) => void;
}) {
  const fav = useFavorites();
  return (
    <View>
      <Pressable style={[styles.row, { borderBottomColor: c.line }]} onPress={() => onOpen(null)} disabled={editing}>
        <View style={[styles.icon, { backgroundColor: c.surface2 }]}>
          <Text>★</Text>
        </View>
        <Text style={[styles.name, { color: c.text }]}>전체</Text>
        <Text style={{ color: c.muted }}>{fav.items.length}</Text>
        <Text style={[styles.chev, { color: c.muted }]}>›</Text>
      </Pressable>
      {fav.groups.map((g) => {
        const count = fav.items.filter((it) => it.groupIds.includes(g.id)).length;
        return (
          <Pressable key={g.id} style={[styles.row, { borderBottomColor: c.line }]} onPress={() => (editing ? onEdit(g) : onOpen(g.id))}>
            <View style={[styles.icon, { backgroundColor: colorHex(g.color) }]}>
              <Text style={{ color: "#fff", fontWeight: "800" }}>★</Text>
            </View>
            <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
              {g.name}
            </Text>
            {editing ? (
              <View style={{ flexDirection: "row", gap: 16 }}>
                <Pressable onPress={() => onEdit(g)} hitSlop={8}>
                  <Text style={{ color: c.accent, fontWeight: "600" }}>수정</Text>
                </Pressable>
                {g.id !== DEFAULT_GROUP_ID && (
                  <Pressable
                    hitSlop={8}
                    onPress={() =>
                      Alert.alert("리스트 삭제", `'${g.name}' 리스트를 지울까요? 이 리스트에만 있던 식당은 저장에서 빠져요.`, [
                        { text: "취소" },
                        { text: "삭제", style: "destructive", onPress: () => fav.deleteGroup(g.id) },
                      ])
                    }
                  >
                    <Text style={{ color: c.errorText, fontWeight: "600" }}>삭제</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <>
                <Text style={{ color: c.muted }}>{count}</Text>
                <Text style={[styles.chev, { color: c.muted }]}>›</Text>
              </>
            )}
          </Pressable>
        );
      })}
      {fav.items.length === 0 && (
        <Text style={[styles.empty, { color: c.muted }]}>아직 저장한 식당이 없어요.{"\n"}식당 정보에서 ☆ 저장을 눌러 리스트에 담아보세요.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10, gap: 4 },
  title: { fontSize: 18, fontWeight: "800" },
  headBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  name: { flex: 1, fontSize: 16, fontWeight: "600" },
  chev: { fontSize: 20, marginLeft: 4 },
  empty: { textAlign: "center", fontSize: 14, lineHeight: 22, paddingVertical: 28 },
});
