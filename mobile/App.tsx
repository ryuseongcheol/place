import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchRecommendations, fetchThemes, type PresetChip } from "./src/api";
import BottomSheet, { type BottomSheetRef, type SheetSnap } from "./src/BottomSheet";
import { FavoritesProvider, useFavorites } from "./src/favorites";
import { PlaceBody, PlaceHeader } from "./src/PlaceDetailView";
import { ListHeader, PlaceList } from "./src/PlaceList";
import PlacesMap, { type PlacesMapRef } from "./src/PlacesMap";
import SearchPanel from "./src/SearchPanel";
import { useColors } from "./src/theme";
import type { RecommendResponse, ScoredPlace } from "./src/types";
import { useLocation } from "./src/useLocation";
import WebViewModal, { type WebTarget } from "./src/WebViewModal";

const HALF_RATIO = 0.45;

type SheetState =
  | { mode: "list" }
  | { mode: "detail"; place: ScoredPlace; fromList: boolean };

export default function App() {
  return (
    <SafeAreaProvider>
      <FavoritesProvider>
        <MapScreen />
      </FavoritesProvider>
    </SafeAreaProvider>
  );
}

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const s = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

function MapScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();
  const { loc, locate } = useLocation();
  const fav = useFavorites();

  // 추천 조건
  const [presets, setPresets] = useState<PresetChip[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [radius, setRadius] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 화면 상태
  const [searchOpen, setSearchOpen] = useState(true); // 앱 실행 시 추천 팝업을 바로 띄운다
  const [data, setData] = useState<RecommendResponse | null>(null);
  const [listSource, setListSource] = useState<"results" | "favorites">("results");
  const [sheet, setSheet] = useState<SheetState>({ mode: "list" });
  const [snap, setSnap] = useState<SheetSnap>("closed");
  const [webTarget, setWebTarget] = useState<WebTarget | null>(null);

  const mapRef = useRef<PlacesMapRef>(null);
  const sheetRef = useRef<BottomSheetRef>(null);

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

  const me = loc.status === "locating" ? null : { lat: loc.lat, lng: loc.lng };
  const mapPlaces = listSource === "favorites" ? fav.favorites : (data?.places ?? []);
  const selectedId = snap !== "closed" && sheet.mode === "detail" ? sheet.place.id : null;
  const favoriteIds = useMemo(() => new Set(fav.favorites.map((f) => f.id)), [fav.favorites]);
  const distanceOf = useCallback((p: ScoredPlace) => (me ? haversine(me, p) : null), [me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  async function search() {
    if (loc.status === "locating") return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRecommendations({ lat: loc.lat, lng: loc.lng, radius, presetId, text: text.trim() || null });
      if (res.places.length === 0) {
        setError(res.warnings[res.warnings.length - 1] ?? "조건에 맞는 식당을 찾지 못했어요. 반경을 넓혀보세요.");
        return;
      }
      setData(res);
      setListSource("results");
      setSearchOpen(false);
      setSheet({ mode: "list" });
      setSnap("half");
      sheetRef.current?.scrollToTop();
    } catch (e) {
      setError(e instanceof Error ? e.message : "추천을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }

  const openDetail = useCallback((place: ScoredPlace, fromList: boolean) => {
    setSheet({ mode: "detail", place, fromList });
    setSnap((s) => (s === "full" && fromList ? "full" : "half"));
    sheetRef.current?.scrollToTop();
    mapRef.current?.focus(place.lat, place.lng);
  }, []);

  const openList = (source: "results" | "favorites") => {
    setListSource(source);
    setSheet({ mode: "list" });
    setSnap("half");
    setSearchOpen(false);
    sheetRef.current?.scrollToTop();
  };

  const backToList = () => {
    setSheet({ mode: "list" });
    sheetRef.current?.scrollToTop();
    mapRef.current?.fitAll();
  };

  const closeSheet = () => setSnap("closed");

  // 안드로이드 뒤로가기: 팝업 → 상세 → 목록 → 시트 순으로 닫기
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (webTarget) return false; // 웹뷰 모달이 직접 처리
      if (searchOpen) {
        setSearchOpen(false);
        return true;
      }
      if (snap !== "closed") {
        if (sheet.mode === "detail" && sheet.fromList) backToList();
        else closeSheet();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  });

  const topBarHeight = 56;
  const summary = data ? `${data.query.summary} · ${data.places.length}곳` : "맛집 추천받기";

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={c.bg === "#16130F" ? "light" : "dark"} />

      {/* 1. 전체 화면 지도 */}
      <PlacesMap
        ref={mapRef}
        me={me}
        places={mapPlaces}
        selectedId={selectedId}
        favoriteIds={favoriteIds}
        starMarkers={listSource === "favorites"}
        onSelect={(p) => openDetail(p, false)}
        onTapMap={() => snap === "half" && closeSheet()}
        padding={{ top: insets.top + topBarHeight, bottom: snap === "half" ? Math.round(H * HALF_RATIO) : 0 }}
        colors={c}
      />

      {/* 상단 바: 현재 추천 요약 + 즐겨찾기 */}
      <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable
          style={[styles.searchPill, { backgroundColor: c.surface }]}
          onPress={() => (data ? openList("results") : setSearchOpen(true))}
          accessibilityRole="button"
        >
          <Text style={{ fontSize: 16 }}>🍽</Text>
          <Text style={{ flex: 1, fontSize: 15, color: data ? c.text : c.muted, fontWeight: data ? "600" : "400" }} numberOfLines={1}>
            {summary}
          </Text>
          {data && <Text style={{ color: c.muted, fontSize: 13 }}>목록</Text>}
        </Pressable>
        <Pressable
          style={[styles.roundBtn, { backgroundColor: listSource === "favorites" && snap !== "closed" ? "#F5A400" : c.surface }]}
          onPress={() => openList("favorites")}
          accessibilityRole="button"
          accessibilityLabel="즐겨찾기"
        >
          <Text style={{ fontSize: 20, color: listSource === "favorites" && snap !== "closed" ? "#fff" : "#F5A400" }}>★</Text>
        </Pressable>
      </View>

      {/* 3. 지도 화면의 맛집추천 버튼 + 내 위치 */}
      {snap === "closed" && !searchOpen && (
        <View style={[styles.bottomBar, { bottom: insets.bottom + 20 }]} pointerEvents="box-none">
          <Pressable style={[styles.recommendBtn, { backgroundColor: c.accent }]} onPress={() => setSearchOpen(true)} accessibilityRole="button">
            <Text style={styles.recommendText}>🍽 맛집추천</Text>
          </Pressable>
          <Pressable
            style={[styles.roundBtn, styles.myLoc, { backgroundColor: c.surface }]}
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

      {/* 4. 바텀시트: 목록 / 식당 상세 (반 팝업 ↔ 전체) */}
      <BottomSheet
        ref={sheetRef}
        snap={snap}
        onSnapChange={setSnap}
        colors={c}
        halfRatio={HALF_RATIO}
        header={
          sheet.mode === "detail" ? (
            <PlaceHeader
              place={sheet.place}
              colors={c}
              distance={distanceOf(sheet.place)}
              onBack={sheet.fromList ? backToList : undefined}
              onClose={closeSheet}
            />
          ) : listSource === "favorites" ? (
            <ListHeader title={`즐겨찾기 ${fav.favorites.length}`} subtitle="기기에 저장된 식당" colors={c} onClose={closeSheet} />
          ) : (
            <ListHeader
              title={data?.query.summary ?? "추천 결과"}
              subtitle={data ? `검색어: ${data.query.keywords.join(", ")}${data.region ? ` · ${data.region}` : ""}` : undefined}
              colors={c}
              onClose={closeSheet}
            />
          )
        }
      >
        {sheet.mode === "detail" ? (
          <PlaceBody
            place={sheet.place}
            colors={c}
            isFavorite={fav.isFavorite(sheet.place.id)}
            onToggleFavorite={() => fav.toggle(sheet.place)}
            openWeb={setWebTarget}
          />
        ) : (
          <PlaceList
            places={mapPlaces}
            colors={c}
            distanceOf={distanceOf}
            onPick={(p) => openDetail(p, true)}
            numbered={listSource === "results"}
            notices={listSource === "results" ? data?.warnings : undefined}
            emptyText={listSource === "favorites" ? "저장한 식당이 없어요.\n식당 정보에서 ☆ 저장을 눌러보세요." : "추천 결과가 없어요."}
          />
        )}
      </BottomSheet>

      {/* 2. 추천 팝업 (앱 실행 시 기본 표시) */}
      {searchOpen && (
        <SearchPanel
          colors={c}
          loc={loc}
          onRelocate={locate}
          presets={presets}
          presetId={presetId}
          setPresetId={setPresetId}
          text={text}
          setText={setText}
          radius={radius}
          setRadius={setRadius}
          aiEnabled={aiEnabled}
          loading={loading}
          error={error}
          serverError={serverError}
          onRetryServer={loadThemes}
          onSubmit={search}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* 5. 리뷰·블로그 웹뷰 */}
      <WebViewModal target={webTarget} onClose={() => setWebTarget(null)} colors={c} />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { position: "absolute", left: 12, right: 12, flexDirection: "row", gap: 8 },
  searchPill: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  roundBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  bottomBar: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  recommendBtn: {
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  recommendText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  myLoc: { position: "absolute", right: 12, bottom: 2 },
});
