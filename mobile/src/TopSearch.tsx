import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { RegionProgress } from "./regions";
import type { ThemePreset } from "./shared";
import type { Colors } from "./theme";
import type { Region } from "./types";

export type Source = { kind: "nearby" } | { kind: "region"; region: Region };

interface Props {
  colors: Colors;
  top: number;
  text: string;
  setText: (t: string) => void;
  onSubmitText: () => void;
  loading: boolean;
  source: Source;
  regions: Region[];
  progress: Record<string, RegionProgress>;
  onPickSource: (s: Source) => void;
  themes: ThemePreset[];
  activeThemeId: string | null;
  onPickTheme: (t: ThemePreset) => void;
  onOpenSettings: () => void;
}

export function progressText(p: RegionProgress | undefined): string {
  if (!p) return "대기 중";
  switch (p.phase) {
    case "waiting":
      return "수집 대기 중";
    case "listing":
      return `식당 목록 모으는 중 · ${p.listed}곳`;
    case "detail":
      return `분석 중 ${p.detailed}/${p.target}`;
    case "done":
      return `${p.listed}곳 수집 완료`;
    case "error":
      return `오류: ${p.message ?? "수집 실패"}`;
  }
}

/** 지도 위 상단: 검색창 + 설정, 그 아래 검색 범위(내 주변/지역) + 주제 칩 */
export default function TopSearch(p: Props) {
  const c = p.colors;
  const [menuOpen, setMenuOpen] = useState(false);
  const sourceLabel = p.source.kind === "nearby" ? "📍 내 주변" : `🏘 ${p.source.region.name}`;

  return (
    <View style={[styles.wrap, { top: p.top }]} pointerEvents="box-none">
      <View style={styles.row}>
        <View style={[styles.search, { backgroundColor: c.surface }]}>
          <Text style={{ fontSize: 16, color: c.muted }}>🔍</Text>
          <TextInput
            value={p.text}
            onChangeText={p.setText}
            placeholder={p.source.kind === "nearby" ? "메뉴, 분위기, 상황으로 검색" : `${p.source.region.name}에서 검색`}
            placeholderTextColor={c.muted}
            returnKeyType="search"
            onSubmitEditing={() => p.text.trim() && p.onSubmitText()}
            style={[styles.input, { color: c.text }]}
            maxLength={100}
          />
          {p.loading ? (
            <ActivityIndicator color={c.accent} />
          ) : (
            !!p.text && (
              <Pressable onPress={() => p.setText("")} hitSlop={10} accessibilityLabel="검색어 지우기">
                <Text style={{ color: c.muted, fontSize: 16 }}>✕</Text>
              </Pressable>
            )
          )}
        </View>
        <Pressable style={[styles.round, { backgroundColor: c.surface }]} onPress={p.onOpenSettings} accessibilityRole="button" accessibilityLabel="설정">
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        <Pressable
          style={[styles.chip, styles.sourceChip, { backgroundColor: c.text, borderColor: c.text }]}
          onPress={() => setMenuOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="검색 범위 선택"
        >
          <Text style={{ color: c.bg, fontWeight: "700", fontSize: 13 }}>{sourceLabel} ▾</Text>
        </Pressable>
        {p.themes.map((t) => {
          const on = p.activeThemeId === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => p.onPickTheme(t)}
              style={[styles.chip, { backgroundColor: on ? c.accent : c.surface, borderColor: on ? c.accent : c.line }]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={{ fontSize: 13, color: on ? "#fff" : c.text, fontWeight: on ? "700" : "500" }}>
                {t.emoji} {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {menuOpen && (
        <View style={[styles.menu, { backgroundColor: c.surface }]}>
          <MenuItem
            c={c}
            title="📍 내 주변"
            sub="지금 위치에서 실시간으로 검색"
            active={p.source.kind === "nearby"}
            onPress={() => {
              setMenuOpen(false);
              p.onPickSource({ kind: "nearby" });
            }}
          />
          {p.regions.map((r) => (
            <MenuItem
              key={r.id}
              c={c}
              title={`🏘 ${r.name}`}
              sub={`미리 수집 · ${progressText(p.progress[r.id])}`}
              active={p.source.kind === "region" && p.source.region.id === r.id}
              onPress={() => {
                setMenuOpen(false);
                p.onPickSource({ kind: "region", region: r });
              }}
            />
          ))}
          <MenuItem
            c={c}
            title="⚙️ 지역 설정"
            sub={p.regions.length ? `${p.regions.length}/5곳 선택됨` : "자주 가는 동네를 미리 수집해 두세요"}
            onPress={() => {
              setMenuOpen(false);
              p.onOpenSettings();
            }}
          />
        </View>
      )}
    </View>
  );
}

function MenuItem({ c, title, sub, active, onPress }: { c: Colors; title: string; sub: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.menuItem, { borderBottomColor: c.line }, active && { backgroundColor: c.accentSoft }]} accessibilityRole="button">
      <Text style={{ fontSize: 15, fontWeight: "700", color: active ? c.accent : c.text }}>{title}</Text>
      <Text style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{sub}</Text>
    </Pressable>
  );
}

const shadow = { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 6 };

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0 },
  row: { flexDirection: "row", gap: 8, paddingHorizontal: 12 },
  search: { flex: 1, height: 48, borderRadius: 24, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, ...shadow },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
  round: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", ...shadow },
  chips: { gap: 6, paddingHorizontal: 12, paddingVertical: 10 },
  chip: { height: 34, borderRadius: 17, borderWidth: 1, paddingHorizontal: 12, justifyContent: "center", ...shadow, elevation: 3 },
  sourceChip: {},
  menu: { marginHorizontal: 12, borderRadius: 14, overflow: "hidden", ...shadow },
  menuItem: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
