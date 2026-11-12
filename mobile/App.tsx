import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchRecommendations, fetchThemes, searchDb } from "./src/api";
import BottomSheet, { type BottomSheetRef, type SheetSnap } from "./src/BottomSheet";
import { FavoritesProvider, colorHex, useFavorites, type FavGroup } from "./src/favorites";
import { FavGroupsHeader, FavGroupsList } from "./src/FavoritesView";
import { rankByText, rankByTheme } from "./src/localRank";
import { PlaceBody, PlaceHeader } from "./src/PlaceDetailView";
import { ListHeader, PlaceList } from "./src/PlaceList";
import PlacesMap, { type PlacesMapRef } from "./src/PlacesMap";
import { registerBackgroundCrawl } from "./src/backgroundCrawl";
import { RegionsProvider, useRegions } from "./src/regions";
import SaveSheet, { GroupEditor } from "./src/SaveSheet";
import SearchPanel from "./src/SearchPanel";
import SettingsScreen from "./src/SettingsScreen";
import { THEME_PRESETS, getPreset, haversine, type ThemePreset } from "./src/shared";
import { useColors } from "./src/theme";
import TopSearch, { type Source } from "./src/TopSearch";
import type { ScoredPlace } from "./src/types";
import { useLocation } from "./src/useLocation";
import WebViewModal, { type WebTarget } from "./src/WebViewModal";

const HALF_RATIO = 0.45;

type ListMode = { mode: "results" } | { mode: "favGroups" } | { mode: "favList"; groupId: string | null };
type SheetState = ListMode | { mode: "detail"; place: ScoredPlace; back: ListMode | null };

interface Results {
  places: ScoredPlace[];
  title: string;
  subtitle?: string;
  warnings: string[];
}

export default function App() {
  return (
    <SafeAreaProvider>
      <FavoritesProvider>
        <RegionsProvider>
          <MapScreen />
        </RegionsProvider>
      </FavoritesProvider>
    </SafeAreaProvider>
  );
}

function MapScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();
  const { loc, locate } = useLocation();
  const fav = useFavorites();
  const rg = useRegions();

  // 검색 조건
  const [aiEnabled, setAiEnabled] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>({ kind: "nearby" });
  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [panelPreset, setPanelPreset] = useState<string | null>(null);
  const [panelText, setPanelText] = useState("");
  const [radius, setRadius] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 화면 상태
  const [searchOpen, setSearchOpen] = useState(true); // 앱 실행 시 추천 팝업
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [layer, setLayer] = useState<"results" | "favorites">("results");
  const [favGroupId, setFavGroupId] = useState<string | null>(null);
  const [favEditing, setFavEditing] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FavGroup | null | "new">(null);
  const [savePlace, setSavePlace] = useState<ScoredPlace | null>(null);
  const [sheet, setSheet] = useState<SheetState>({ mode: "results" });
  const [snap, setSnap] = useState<SheetSnap>("closed");
  const [webTarget, setWebTarget] = useState<WebTarget | null>(null);

  const mapRef = useRef<PlacesMapRef>(null);
  const sheetRef = useRef<BottomSheetRef>(null);

  const loadServerInfo = useCallback(() => {
    setServerError(null);
    fetchThemes()
      .then((d) => setAiEnabled(d.ai))
      .catch((e: Error) => setServerError(e.message));
  }, []);
  useEffect(loadServerInfo, [loadServerInfo]);
  // 앱이 꺼져 있어도 지역 수집을 이어가도록 백그라운드 작업 등록
  useEffect(() => {
    registerBackgroundCrawl();
  }, []);

  const me = loc.status === "locating" ? null : { lat: loc.lat, lng: loc.lng };
  const distanceOf = useCallback((p: ScoredPlace) => (me ? Math.round(haversine(me, p)) : null), [me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const mapPlaces = layer === "favorites" ? fav.placesIn(favGroupId) : (results?.places ?? []);
  const selectedId = snap !== "closed" && sheet.mode === "detail" ? sheet.place.id : null;
  const favGroupColor = favGroupId ? fav.groups.find((g) => g.id === favGroupId)?.color : null;

  const showList = (mode: ListMode) => {
    setSheet(mode);
    setSnap("half");
    setSearchOpen(false);
    sheetRef.current?.scrollToTop();
  };

  /** 검색 실행: 내 주변이면 서버 실시간 추천, 지역이면 미리 수집한 데이터로 바로 순위 */
  const runSearch = async (opts: { theme?: ThemePreset | null; text?: string }) => {
    const theme = opts.theme ?? null;
    const q = (opts.text ?? "").trim();
    if (!theme && !q) return;
    setLoading(true);
    setError(null);
    try {
      let next: Results;
      if (source.kind === "nearby") {
        if (loc.status === "locating") return;
        const radiusText = radius < 1000 ? `${radius}m` : `${radius / 1000}km`;
        // 1) 서버 DB에 이 근처를 분석해 둔 데이터가 충분하면 바로 (빠르고, 분류값이 정확함)
        const db = await searchDb({ lat: loc.lat, lng: loc.lng, radius, themeId: theme?.id ?? null, q: q || null }).catch(() => null);
        if (db && db.analyzed >= 30 && db.places.length >= 8) {
          next = {
            places: db.places,
            title: q || theme!.label,
            subtitle: `내 주변 ${radiusText} · 저장된 ${db.inArea.toLocaleString()}곳 중 (분석 ${db.analyzed.toLocaleString()}곳)`,
            warnings: [],
          };
        } else {
          // 2) 아니면 실시간 (카카오 검색 + 리뷰 수집)
          const res = await fetchRecommendations({ lat: loc.lat, lng: loc.lng, radius, presetId: theme?.id ?? null, text: q || null });
          next = {
            places: res.places,
            title: res.query.summary,
            subtitle: `내 주변 ${radiusText} · 실시간 · 검색어 ${res.query.keywords.join(", ")}`,
            warnings: res.warnings,
          };
        }
      } else {
        const region = source.region;
        const places = await rg.loadPlaces(region.id);
        const pr = rg.progress[region.id];
        const ranked = q ? rankByText(places, q, me) : rankByTheme(places, theme!, me);
        const warnings: string[] = [];
        if (!places.length) warnings.push("아직 이 지역 맛집을 모으는 중이에요. 설정에서 진행 상황을 볼 수 있어요.");
        else if (pr && pr.phase !== "done") warnings.push(`수집 중이라 ${pr.detailed}/${pr.target}곳만 분석됐어요. 끝나면 더 정확해져요.`);
        next = {
          places: ranked,
          title: `${region.name} · ${q || theme!.label}`,
          subtitle: `미리 수집한 ${places.length}곳 중 ${ranked.length}곳`,
          warnings,
        };
      }
      if (next.places.length === 0 && !next.warnings.length) next.warnings.push("조건에 맞는 곳이 없어요. 다른 주제나 검색어로 찾아보세요.");
      setResults(next);
      setLayer("results");
      showList({ mode: "results" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "추천을 불러오지 못했어요.";
      setError(msg);
      setResults({ places: [], title: "검색 실패", warnings: [msg] });
      showList({ mode: "results" });
    } finally {
      setLoading(false);
    }
  };

  const pickTheme = (t: ThemePreset) => {
    if (activeThemeId === t.id && snap !== "closed" && sheet.mode === "results") return;
    setActiveThemeId(t.id);
    setText("");
    runSearch({ theme: t });
  };

  const submitText = () => {
    setActiveThemeId(null);
    runSearch({ text });
  };

  const pickSource = (s: Source) => {
    setSource(s);
    if (s.kind === "region") mapRef.current?.focus(s.region.lat, s.region.lng, 15);
    else if (me) mapRef.current?.focus(me.lat, me.lng, 15);
  };
  // 범위를 바꾸면 고른 주제/검색어로 다시 찾는다
  const firstSource = useRef(true);
  useEffect(() => {
    if (firstSource.current) {
      firstSource.current = false;
      return;
    }
    const theme = getPreset(activeThemeId);
    if (theme) runSearch({ theme });
    else if (text.trim()) runSearch({ text });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const openDetail = useCallback(
    (place: ScoredPlace, back: ListMode | null) => {
      setSheet({ mode: "detail", place, back });
      setSnap((s) => (s === "full" && back ? "full" : "half"));
      sheetRef.current?.scrollToTop();
      mapRef.current?.focus(place.lat, place.lng);
    },
    [],
  );

  const goBack = () => {
    if (sheet.mode === "detail" && sheet.back) {
      setSheet(sheet.back);
      sheetRef.current?.scrollToTop();
      mapRef.current?.fitAll();
    } else if (sheet.mode === "favList") {
      setSheet({ mode: "favGroups" });
    } else setSnap("closed");
  };

  const openFavorites = () => {
    setLayer("favorites");
    setFavGroupId(null);
    setFavEditing(false);
    showList({ mode: "favGroups" });
  };

  // 안드로이드 뒤로가기
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (webTarget || settingsOpen || savePlace) return false;
      if (searchOpen) {
        setSearchOpen(false);
        return true;
      }
      if (snap !== "closed") {
        goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  });

  const topArea = insets.top + 8 + 48 + 54; // 검색창 + 칩
  const listBack = (m: ListMode) => m;

  // ----- 시트 내용 -----
  let header: React.ReactNode;
  let body: React.ReactNode;
  if (sheet.mode === "detail") {
    header = (
      <PlaceHeader place={sheet.place} colors={c} distance={distanceOf(sheet.place)} onBack={sheet.back ? goBack : undefined} onClose={() => setSnap("closed")} />
    );
    body = <PlaceBody place={sheet.place} colors={c} isFavorite={fav.isFavorite(sheet.place.id)} onSave={() => setSavePlace(sheet.place)} openWeb={setWebTarget} />;
  } else if (sheet.mode === "favGroups") {
    header = <FavGroupsHeader colors={c} editing={favEditing} setEditing={setFavEditing} onNew={() => setEditingGroup("new")} onClose={() => setSnap("closed")} />;
    body = (
      <FavGroupsList
        colors={c}
        editing={favEditing}
        onEdit={(g) => setEditingGroup(g)}
        onOpen={(gid) => {
          setFavGroupId(gid);
          setLayer("favorites");
          setSheet({ mode: "favList", groupId: gid });
          sheetRef.current?.scrollToTop();
        }}
      />
    );
  } else if (sheet.mode === "favList") {
    const g = sheet.groupId ? fav.groups.find((x) => x.id === sheet.groupId) : null;
    const places = fav.placesIn(sheet.groupId);
    header = (
      <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 8 }}>
        <Pressable onPress={goBack} hitSlop={10} style={{ padding: 6 }} accessibilityLabel="리스트 목록으로">
          <Text style={{ fontSize: 24, color: c.text }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <ListHeader title={`${g?.name ?? "전체"} ${places.length}`} subtitle="저장한 식당" colors={c} onClose={() => setSnap("closed")} />
        </View>
      </View>
    );
    body = (
      <PlaceList
        places={places}
        colors={c}
        distanceOf={distanceOf}
        onPick={(p) => openDetail(p, listBack({ mode: "favList", groupId: sheet.groupId }))}
        numbered={false}
        badgeColor={(p) => colorHex(fav.colorOf(p.id) ?? "red")}
        emptyText="이 리스트에 저장한 식당이 없어요."
      />
    );
  } else {
    header = <ListHeader title={results?.title ?? "추천 결과"} subtitle={results?.subtitle} colors={c} onClose={() => setSnap("closed")} />;
    body = (
      <PlaceList
        places={results?.places ?? []}
        colors={c}
        distanceOf={distanceOf}
        onPick={(p) => openDetail(p, { mode: "results" })}
        numbered
        notices={results?.warnings}
        emptyText="추천 결과가 없어요."
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={c.bg === "#16130F" ? "light" : "dark"} />

      {/* 전체 화면 지도 */}
      <PlacesMap
        ref={mapRef}
        me={me}
        places={mapPlaces}
        selectedId={selectedId}
        markerColor={(p) => (layer === "favorites" ? (favGroupColor ?? fav.colorOf(p.id) ?? "red") : fav.colorOf(p.id))}
        starMarkers={layer === "favorites"}
        onSelect={(p) => openDetail(p, null)}
        onTapMap={() => snap === "half" && setSnap("closed")}
        padding={{ top: topArea, bottom: snap === "half" ? Math.round(H * HALF_RATIO) : 0 }}
        colors={c}
      />

      {/* 1. 상단 검색 영역 */}
      {snap !== "full" && (
        <TopSearch
          colors={c}
          top={insets.top + 8}
          text={text}
          setText={setText}
          onSubmitText={submitText}
          loading={loading}
          source={source}
          regions={rg.regions}
          progress={rg.progress}
          onPickSource={pickSource}
          themes={THEME_PRESETS}
          activeThemeId={activeThemeId}
          onPickTheme={pickTheme}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {/* 2. 하단: 저장(즐겨찾기) · 맛집추천 · 내 위치 */}
      {snap === "closed" && !searchOpen && (
        <View style={[styles.bottomBar, { bottom: insets.bottom + 20 }]} pointerEvents="box-none">
          <Pressable style={[styles.pill, { backgroundColor: c.surface }]} onPress={openFavorites} accessibilityRole="button" accessibilityLabel="저장 리스트">
            <Text style={{ fontSize: 16, color: "#F5A400" }}>★</Text>
            <Text style={{ fontSize: 14, fontWeight: "700", color: c.text }}>저장</Text>
          </Pressable>
          <Pressable style={[styles.recommendBtn, { backgroundColor: c.accent }]} onPress={() => setSearchOpen(true)} accessibilityRole="button">
            <Text style={styles.recommendText}>🍽 맛집추천</Text>
          </Pressable>
          <Pressable
            style={[styles.round, { backgroundColor: c.surface }]}
            onPress={() => {
              locate();
              if (me) mapRef.current?.focus(me.lat, me.lng, 15);
            }}
            accessibilityRole="button"
            accessibilityLabel="내 위치"
          >
            <Text style={{ fontSize: 18, color: "#1a73e8" }}>◎</Text>
          </Pressable>
        </View>
      )}
      {snap === "closed" && !searchOpen && results && layer === "results" && results.places.length > 0 && (
        <Pressable style={[styles.listBtn, { bottom: insets.bottom + 84, backgroundColor: c.surface }]} onPress={() => showList({ mode: "results" })}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: c.text }}>☰ 목록 {results.places.length}</Text>
        </Pressable>
      )}

      {/* 바텀시트: 결과 목록 / 저장 리스트 / 식당 상세 */}
      <BottomSheet ref={sheetRef} snap={snap} onSnapChange={setSnap} colors={c} halfRatio={HALF_RATIO} header={header}>
        {body}
      </BottomSheet>

      {/* 맛집추천 팝업 (앱 실행 시 기본 표시) */}
      {searchOpen && (
        <SearchPanel
          colors={c}
          loc={loc}
          onRelocate={locate}
          presets={THEME_PRESETS}
          presetId={panelPreset}
          setPresetId={setPanelPreset}
          text={panelText}
          setText={setPanelText}
          radius={radius}
          setRadius={setRadius}
          aiEnabled={aiEnabled}
          loading={loading}
          error={error}
          serverError={serverError}
          onRetryServer={loadServerInfo}
          sourceLabel={source.kind === "nearby" ? "내 주변 (실시간)" : `${source.region.name} (미리 수집)`}
          onSubmit={() => {
            const theme = getPreset(panelPreset) ?? null;
            setActiveThemeId(panelText.trim() ? null : (theme?.id ?? null));
            setText(panelText);
            runSearch({ theme, text: panelText });
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}

      <SettingsScreen visible={settingsOpen} onClose={() => setSettingsOpen(false)} colors={c} me={me} radius={radius} setRadius={setRadius} />
      <SaveSheet place={savePlace} onClose={() => setSavePlace(null)} colors={c} />
      <GroupEditor visible={editingGroup !== null} group={editingGroup === "new" ? null : editingGroup} colors={c} onClose={() => setEditingGroup(null)} />
      <WebViewModal target={webTarget} onClose={() => setWebTarget(null)} colors={c} />
    </View>
  );
}

const shadow = { shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 6 };

const styles = StyleSheet.create({
  bottomBar: { position: "absolute", left: 12, right: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pill: { height: 48, borderRadius: 24, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 6, ...shadow },
  recommendBtn: { height: 52, borderRadius: 26, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", ...shadow },
  recommendText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  round: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", ...shadow },
  listBtn: { position: "absolute", alignSelf: "center", height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center", ...shadow },
});
