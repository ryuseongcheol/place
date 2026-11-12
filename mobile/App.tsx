import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { fetchRecommendations, fetchThemes, type PresetChip } from "./src/api";
import { callPhone, openKakaoMap, openNaverMap } from "./src/openMap";
import PlacesMap from "./src/PlacesMap";
import { useColors, type Colors } from "./src/theme";
import type { RecommendResponse, ScoredPlace, SourceStatus } from "./src/types";
import { useLocation } from "./src/useLocation";

const RADII = [500, 1000, 2000];

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { loc, locate } = useLocation();

  const [presets, setPresets] = useState<PresetChip[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [radius, setRadius] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RecommendResponse | null>(null);
  const [searchedAt, setSearchedAt] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<FlatList<ScoredPlace>>(null);

  const loadThemes = useCallback(() => {
    setServerError(null);
    fetchThemes()
      .then((d) => {
        setPresets(d.presets);
        setAiEnabled(d.ai);
      })
      .catch((e: Error) => setServerError(e.message));
  }, []);

  useEffect(loadThemes, [loadThemes]);

  const hasPosition = loc.status !== "locating";
  const canSearch = hasPosition && !loading && (presetId !== null || text.trim().length > 0);

  async function search() {
    if (loc.status === "locating") return;
    Keyboard.dismiss();
    setLoading(true);
    setError(null);
    setSelectedId(null);
    try {
      const res = await fetchRecommendations({ lat: loc.lat, lng: loc.lng, radius, presetId, text: text.trim() || null });
      setData(res);
      setSearchedAt({ lat: loc.lat, lng: loc.lng });
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "추천을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }

  const selectFromMap = useCallback(
    (id: string) => {
      setSelectedId(id);
      const index = data?.places.findIndex((p) => p.id === id) ?? -1;
      if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
    },
    [data],
  );

  const header = (
    <View>
      <View style={s.brandRow}>
        <Text style={s.brand}>
          근처<Text style={{ color: c.accent }}>맛집</Text>
        </Text>
        <Text style={s.brandSub}>카카오맵 · 네이버지도 리뷰 기반</Text>
      </View>

      <View style={s.panel}>
        <View style={s.locRow}>
          <View style={[s.dot, { backgroundColor: loc.status === "ok" ? c.naver : c.muted }]} />
          <Text style={s.locText} numberOfLines={1}>
            {loc.status === "locating" ? "현재 위치 확인 중…" : loc.status === "ok" ? "현재 위치 기준" : "강남역 기준 (기본 위치)"}
          </Text>
          <Pressable style={s.ghost} onPress={locate} disabled={loc.status === "locating"} accessibilityRole="button">
            <Text style={s.ghostText}>위치 다시 찾기</Text>
          </Pressable>
        </View>
        {loc.status === "fallback" && <Notice c={c} text={loc.message} />}
        {serverError && (
          <Pressable onPress={loadThemes}>
            <Notice c={c} error text={`${serverError}\n눌러서 다시 시도`} />
          </Pressable>
        )}

        <Text style={s.label}>어떤 식당을 찾으세요?</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
          {presets.map((p) => {
            const on = presetId === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => setPresetId(on ? null : p.id)}
                style={[s.chip, on && { backgroundColor: c.accentSoft, borderColor: c.accent }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.chipText, on && { color: c.accent, fontWeight: "700" }]}>
                  {p.emoji} {p.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={s.label}>원하는 걸 자유롭게 적어도 돼요{!aiEnabled ? " (AI 미연결: 검색어로 사용)" : ""}</Text>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder="예: 비 오는 날 혼자 조용히 먹을 따뜻한 국물"
          placeholderTextColor={c.muted}
          maxLength={200}
          returnKeyType="search"
          onSubmitEditing={() => canSearch && search()}
        />

        <View style={s.actionRow}>
          <View style={s.seg}>
            {RADII.map((r, i) => {
              const on = radius === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setRadius(r)}
                  style={[s.segBtn, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line }, on && { backgroundColor: c.text }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[s.segText, on && { color: c.bg, fontWeight: "700" }]}>{r < 1000 ? `${r}m` : `${r / 1000}km`}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable style={[s.primary, !canSearch && { opacity: 0.5 }]} onPress={search} disabled={!canSearch} accessibilityRole="button">
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>추천 받기</Text>}
          </Pressable>
        </View>
        {!presetId && !text.trim() && <Text style={s.hint}>테마를 고르거나 원하는 걸 입력하면 추천을 받을 수 있어요.</Text>}
        {error && <Notice c={c} error text={error} />}
      </View>

      {loading && <Text style={s.loadingText}>카카오맵·네이버지도 리뷰를 모아서 분석하고 있어요…</Text>}

      {!loading && data && searchedAt && (
        <View style={{ marginTop: 20 }}>
          <Text style={s.summary}>
            <Text style={{ color: c.text, fontWeight: "700" }}>{data.query.summary}</Text>
            {data.region ? ` · ${data.region}` : ""}
            {"\n"}검색어: {data.query.keywords.join(", ")}
          </Text>
          <Sources c={c} sources={data.sources} />
          {data.warnings.map((w) => (
            <Notice key={w} c={c} text={w} />
          ))}
          {data.places.length > 0 && (
            <PlacesMap center={searchedAt} places={data.places} selectedId={selectedId} onSelect={selectFromMap} colors={c} />
          )}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
      <StatusBar style="auto" />
      <FlatList
        ref={listRef}
        data={loading ? [] : (data?.places ?? [])}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item, index }) => (
          <PlaceCard place={item} rank={index + 1} c={c} s={s} selected={item.id === selectedId} onPress={() => setSelectedId(item.id)} />
        )}
        ListEmptyComponent={
          !loading && data ? (
            <Text style={s.empty}>조건에 맞는 식당을 찾지 못했어요.{"\n"}반경을 넓히거나 다른 테마로 찾아보세요.</Text>
          ) : undefined
        }
        ListFooterComponent={
          <Text style={s.foot}>
            별점·리뷰 수는 카카오맵·네이버지도의 공개 정보를 참고용으로 가져온 것이며 실제와 다를 수 있어요.
          </Text>
        }
        onScrollToIndexFailed={({ index, averageItemLength }) =>
          listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: true })
        }
      />
    </SafeAreaView>
  );
}

function Notice({ c, text, error }: { c: Colors; text: string; error?: boolean }) {
  return (
    <View style={{ backgroundColor: error ? c.errorBg : c.warnBg, borderRadius: 10, padding: 10, marginTop: 12 }}>
      <Text style={{ color: error ? c.errorText : c.warnText, fontSize: 13, lineHeight: 19 }}>{text}</Text>
    </View>
  );
}

const SOURCE_LABEL: Record<keyof RecommendResponse["sources"], string> = {
  kakaoSearch: "카카오 검색",
  kakaoReviews: "카카오 별점",
  naverReviews: "네이버 리뷰",
  ai: "AI 추천",
};
const STATUS_LABEL: Record<SourceStatus, string> = { ok: "정상", partial: "일부", failed: "실패", disabled: "꺼짐", mock: "예시" };

function Sources({ c, sources }: { c: Colors; sources: RecommendResponse["sources"] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
      {(Object.keys(sources) as Array<keyof typeof sources>).map((k) => {
        const st = sources[k];
        const ok = st === "ok";
        const failed = st === "failed";
        return (
          <View key={k} style={{ backgroundColor: ok ? c.naverBg : failed ? c.errorBg : c.surface2, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 11, color: ok ? c.naver : failed ? c.errorText : c.muted }}>
              {SOURCE_LABEL[k]} {STATUS_LABEL[st]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function formatDistance(m: number) {
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

function PlaceCard({
  place: p,
  rank,
  c,
  s,
  selected,
  onPress,
}: {
  place: ScoredPlace;
  rank: number;
  c: Colors;
  s: ReturnType<typeof makeStyles>;
  selected: boolean;
  onPress: () => void;
}) {
  const [showReviews, setShowReviews] = useState(false);
  const category = p.category.split(">").slice(-2).join(" · ").trim();
  const walkMin = Math.max(1, Math.round(p.distance / 70));
  const snippets = p.kakao?.snippets ?? [];
  const naverHas = p.naver && (p.naver.visitorReviewCount > 0 || p.naver.blogReviewCount > 0);

  return (
    <Pressable onPress={onPress} style={[s.card, selected && { borderColor: c.accent, borderWidth: 1.5 }]}>
      <View style={s.cardHead}>
        <View style={[s.rank, selected && { backgroundColor: c.accent }]}>
          <Text style={s.rankText}>{rank}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{p.name}</Text>
          <Text style={s.meta}>
            {category} · {formatDistance(p.distance)} (도보 약 {walkMin}분)
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={s.score}>{p.score}</Text>
          <Text style={s.scoreLabel}>{p.aiRanked ? "AI 적합도" : "추천 점수"}</Text>
        </View>
      </View>

      <View style={s.badges}>
        {p.kakao?.rating != null ? (
          <Badge bg={c.kakaoBg} fg={c.kakao} text={`카카오 ★ ${p.kakao.rating.toFixed(1)} (${p.kakao.ratingCount.toLocaleString()})`} />
        ) : (
          <Badge bg={c.surface2} fg={c.muted} text="카카오 별점 없음" />
        )}
        {naverHas ? (
          <Badge
            bg={c.naverBg}
            fg={c.naver}
            text={`네이버 ${p.naver!.rating ? `★ ${p.naver!.rating.toFixed(1)} · ` : ""}방문자 ${p.naver!.visitorReviewCount.toLocaleString()} · 블로그 ${p.naver!.blogReviewCount.toLocaleString()}`}
          />
        ) : (
          <Badge bg={c.surface2} fg={c.muted} text="네이버 리뷰 정보 없음" />
        )}
      </View>

      <Text style={s.reason}>{p.reason}</Text>

      {p.highlights.length > 0 && (
        <View style={s.tags}>
          {p.highlights.map((h) => (
            <Text key={h} style={s.tag}>
              {h}
            </Text>
          ))}
        </View>
      )}

      {snippets.length > 0 && (
        <Pressable onPress={() => setShowReviews((v) => !v)} hitSlop={8} accessibilityRole="button">
          <Text style={s.reviewToggle}>
            {showReviews ? "▾" : "▸"} 카카오맵 후기 {snippets.length}개 {showReviews ? "접기" : "보기"}
          </Text>
          {showReviews &&
            snippets.slice(0, 4).map((r) => (
              <Text key={r} style={s.review}>
                • {r}
              </Text>
            ))}
        </Pressable>
      )}

      <View style={s.links}>
        <Pressable style={[s.linkBtn, { backgroundColor: c.kakaoBg }]} onPress={() => openKakaoMap(p)} accessibilityRole="link">
          <Text style={[s.linkText, { color: c.kakao }]}>카카오맵</Text>
        </Pressable>
        <Pressable style={[s.linkBtn, { backgroundColor: c.naverBg }]} onPress={() => openNaverMap(p)} accessibilityRole="link">
          <Text style={[s.linkText, { color: c.naver }]}>네이버지도</Text>
        </Pressable>
        {!!p.phone && (
          <Pressable style={[s.linkBtn, { backgroundColor: c.surface2, flex: 0.6 }]} onPress={() => callPhone(p.phone)} accessibilityRole="button">
            <Text style={[s.linkText, { color: c.text }]}>전화</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

function Badge({ bg, fg, text }: { bg: string; fg: string; text: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: "600" }}>{text}</Text>
    </View>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    content: { padding: 16, paddingBottom: 48 },
    brandRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 },
    brand: { fontSize: 24, fontWeight: "800", color: c.text, letterSpacing: -0.5 },
    brandSub: { fontSize: 12, color: c.muted },
    panel: { backgroundColor: c.surface, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, padding: 16 },
    locRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    locText: { flex: 1, fontSize: 14, fontWeight: "700", color: c.text },
    ghost: { borderWidth: 1, borderColor: c.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    ghostText: { fontSize: 13, color: c.text },
    label: { fontSize: 13, fontWeight: "600", color: c.muted, marginTop: 18, marginBottom: 8 },
    chips: { gap: 8, paddingRight: 8 },
    chip: { borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, borderRadius: 999, paddingHorizontal: 13, minHeight: 40, justifyContent: "center" },
    chipText: { fontSize: 14, color: c.text },
    input: {
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: c.text,
      backgroundColor: c.surface,
    },
    actionRow: { flexDirection: "row", gap: 10, marginTop: 16, alignItems: "stretch" },
    seg: { flexDirection: "row", borderWidth: 1, borderColor: c.line, borderRadius: 10, overflow: "hidden" },
    segBtn: { paddingHorizontal: 12, minHeight: 46, justifyContent: "center", backgroundColor: c.surface },
    segText: { fontSize: 13, color: c.text },
    primary: { flex: 1, backgroundColor: c.accent, borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 46 },
    primaryText: { color: "#fff", fontSize: 16, fontWeight: "800" },
    hint: { fontSize: 12, color: c.muted, marginTop: 10 },
    loadingText: { textAlign: "center", color: c.muted, marginTop: 28, fontSize: 14 },
    summary: { fontSize: 14, color: c.muted, lineHeight: 21, marginBottom: 8 },
    card: { backgroundColor: c.surface, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, padding: 16 },
    cardHead: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    rank: { width: 28, height: 28, borderRadius: 8, backgroundColor: c.text, alignItems: "center", justifyContent: "center" },
    rankText: { color: c.bg, fontWeight: "800", fontSize: 14 },
    name: { fontSize: 17, fontWeight: "700", color: c.text },
    meta: { fontSize: 13, color: c.muted, marginTop: 3 },
    score: { fontSize: 20, fontWeight: "800", color: c.accent },
    scoreLabel: { fontSize: 11, color: c.muted },
    badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
    reason: { fontSize: 14, lineHeight: 22, color: c.text, marginTop: 12 },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
    tag: {
      fontSize: 12,
      color: c.muted,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 3,
      overflow: "hidden",
    },
    reviewToggle: { fontSize: 13, color: c.muted, marginTop: 12 },
    review: { fontSize: 13, color: c.muted, lineHeight: 20, marginTop: 4, paddingLeft: 4 },
    links: { flexDirection: "row", gap: 8, marginTop: 14 },
    linkBtn: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: "center" },
    linkText: { fontSize: 13, fontWeight: "700" },
    empty: { textAlign: "center", color: c.muted, fontSize: 14, lineHeight: 22, paddingVertical: 32 },
    foot: { fontSize: 11, color: c.muted, textAlign: "center", marginTop: 28, lineHeight: 17 },
  });
}
