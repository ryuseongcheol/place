import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, BackHandler, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchRecommendations, fetchThemes, rerankRecommendations, searchByName, searchDb } from "./src/api";
import BottomSheet, { type BottomSheetRef, type SheetSnap } from "./src/BottomSheet";
import { FavoritesProvider, colorHex, useFavorites, type FavGroup } from "./src/favorites";
import { MyNotesProvider, useMyNotes } from "./src/myNotes";
import { FavGroupsHeader, FavGroupsList } from "./src/FavoritesView";
import { rankByText, rankByTheme } from "./src/localRank";
import { PlaceBody, PlaceHeader } from "./src/PlaceDetailView";
import { ListHeader, PlaceList } from "./src/PlaceList";
import PlacesMap, { type PlacesMapRef } from "./src/PlacesMap";
import PlaceCarousel, { CARD_HEIGHT, type PlaceCarouselRef } from "./src/PlaceCarousel";
import { checkLatestRelease } from "./src/appVersion";
import { registerBackgroundCrawl } from "./src/backgroundCrawl";
import { rememberLocation, syncPayments } from "./src/payments";
import { snapToScored } from "./src/placeSnap";
import TimelineScreen from "./src/TimelineScreen";
import { RegionsProvider, useRegions } from "./src/regions";
import SaveSheet, { GroupEditor } from "./src/SaveSheet";
import SearchPanel from "./src/SearchPanel";
import { formatRadius, RADIUS_MAX, RADIUS_MIN } from "./src/RadiusSlider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SettingsScreen from "./src/SettingsScreen";
import { haversine, type ThemePreset } from "./src/shared";
import ThemeEditor from "./src/ThemeEditor";
import { ThemesProvider, themeDef, useThemes } from "./src/themes";
import { useColors } from "./src/theme";
import TopSearch, { type Source } from "./src/TopSearch";
import type { ScoredPlace } from "./src/types";
import { useLocation } from "./src/useLocation";
import WebViewModal, { type WebTarget } from "./src/WebViewModal";

/** 검색 반경 저장 키 */
const RADIUS_KEY = "searchRadius.v1";

const HALF_RATIO = 0.45;

type ListMode = { mode: "results" } | { mode: "favGroups" } | { mode: "favList"; groupId: string | null };
type SheetState = ListMode | { mode: "detail"; place: ScoredPlace; back: ListMode | null };

interface Results {
  id: number;
  places: ScoredPlace[];
  title: string;
  subtitle?: string;
  warnings: string[];
  /** AI가 순서를 다듬는 중 */
  aiPending?: boolean;
  /** 더 보기: 이어서 받는 방법 (검색 방식마다 다름) */
  more?: MoreSource;
  /** 더 받을 가게가 있을 것 같은지 */
  hasMore?: boolean;
  loadingMore?: boolean;
}

type MoreSource =
  | { kind: "db"; req: { lat: number; lng: number; radius: number; theme: ReturnType<typeof themeDef> | null; q: string | null } }
  | { kind: "live"; req: Omit<Parameters<typeof fetchRecommendations>[0], "page" | "exclude">; page: number }
  | { kind: "region"; regionId: string; theme: ThemePreset | null; q: string };

/** 지역(미리 모은 데이터)에서 더 보기 한 번에 늘리는 수 */
const REGION_PAGE = 30;

type SortMode = "recommend" | "rating" | "distance" | "reviews";
const SORTS: Array<{ id: SortMode; label: string }> = [
  { id: "recommend", label: "추천순" },
  { id: "rating", label: "별점순" },
  { id: "distance", label: "거리순" },
  { id: "reviews", label: "리뷰많은순" },
];
const reviewVolume = (p: ScoredPlace) =>
  (p.kakao?.reviewCount ?? 0) + (p.naver?.visitorReviewCount ?? 0) + ((p.kakao?.blogReviewCount ?? 0) + (p.naver?.blogReviewCount ?? 0)) * 0.5;

export default function App() {
  return (
    <SafeAreaProvider>
      <MyNotesProvider>
      <FavoritesProvider>
        <RegionsProvider>
        <ThemesProvider>
          <MapScreen />
        </ThemesProvider>
        </RegionsProvider>
      </FavoritesProvider>
      </MyNotesProvider>
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
  const notes = useMyNotes();
  // 지도 마커 픽토그램 글꼴 (마커는 비트맵으로 그려지므로 미리 불러둔다)
  const [iconsReady] = useFonts(MaterialCommunityIcons.font);

  // 검색 조건
  const [aiEnabled, setAiEnabled] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>({ kind: "nearby" });
  const th = useThemes();
  // 고른 주제 (여러 개 가능)
  const [activeThemeIds, setActiveThemeIds] = useState<string[]>([]);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [text, setText] = useState("");
  const [panelThemeIds, setPanelThemeIds] = useState<string[]>([]);
  // 주제를 숨기거나 지우면 고른 목록에서도 뺀다
  useEffect(() => {
    const ok = (id: string) => th.visible.some((t) => t.id === id);
    setActiveThemeIds((ids) => (ids.every(ok) ? ids : ids.filter(ok)));
    setPanelThemeIds((ids) => (ids.every(ok) ? ids : ids.filter(ok)));
  }, [th.visible]);
  const [panelText, setPanelText] = useState("");
  const [radius, setRadiusState] = useState(1000);
  // 검색 반경은 다음에 켤 때도 그대로
  useEffect(() => {
    AsyncStorage.getItem(RADIUS_KEY)
      .then((v) => {
        const n = Number(v);
        if (v && n >= RADIUS_MIN && n <= RADIUS_MAX) setRadiusState(n);
      })
      .catch(() => {});
  }, []);
  const setRadius = useCallback((r: number) => {
    setRadiusState(r);
    AsyncStorage.setItem(RADIUS_KEY, String(r)).catch(() => {});
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 화면 상태
  const [searchOpen, setSearchOpen] = useState(true); // 앱 실행 시 추천 팝업
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
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
  const searchSeq = useRef(0);
  const [sortMode, setSortMode] = useState<SortMode>("recommend");
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
  // 새 버전이 있으면 설정 버튼에 표시
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    checkLatestRelease().then((r) => setUpdateAvailable(Boolean(r?.newer)));
  }, []);

  const me = loc.status === "locating" ? null : { lat: loc.lat, lng: loc.lng };
  // 결제 알림 가져오기: 앱을 켤 때, 다시 앞으로 올 때
  const meRef = useRef(me);
  meRef.current = loc.status === "ok" ? me : null;
  // 결제 위치가 없는 기록을 맞출 때 기준점으로 쓴다
  useEffect(() => {
    if (loc.status === "ok") rememberLocation(loc.lat, loc.lng);
  }, [loc]);
  useEffect(() => {
    const run = () => syncPayments({ fallbackLoc: meRef.current, scan: true }).catch(() => {});
    const t = setTimeout(run, 1500);
    const sub = AppState.addEventListener("change", (st) => st === "active" && run());
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, []);
  const distanceOf = useCallback((p: ScoredPlace) => (me ? Math.round(haversine(me, p)) : null), [me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // 정렬: 목록과 지도 번호가 같은 순서를 쓴다
  const sortPlaces = useCallback(
    (list: ScoredPlace[]) => {
      // 추천순: 내가 2점 이하로 준 곳은 아래로
      if (sortMode === "recommend") {
        const low = (p: ScoredPlace) => ((notes.get(p.id)?.rating ?? 3) <= 2 ? 1 : 0);
        return [...list].sort((a, b) => low(a) - low(b));
      }
      const arr = [...list];
      if (sortMode === "rating")
        arr.sort((a, b) => {
          // 평가 3명 미만은 뒤로 (5.0 한 명짜리가 맨 위에 오지 않게)
          const ra = (a.kakao?.ratingCount ?? 0) >= 3 ? (a.kakao?.rating ?? -1) : -1 + (a.kakao?.rating ?? 0) / 10;
          const rb = (b.kakao?.ratingCount ?? 0) >= 3 ? (b.kakao?.rating ?? -1) : -1 + (b.kakao?.rating ?? 0) / 10;
          return rb - ra || (b.kakao?.ratingCount ?? 0) - (a.kakao?.ratingCount ?? 0);
        });
      else if (sortMode === "distance") arr.sort((a, b) => (distanceOf(a) ?? a.distance) - (distanceOf(b) ?? b.distance));
      else if (sortMode === "reviews") arr.sort((a, b) => reviewVolume(b) - reviewVolume(a));
      return arr;
    },
    [sortMode, distanceOf, notes],
  );
  const resultPlaces = useMemo(() => sortPlaces(results?.places ?? []), [results, sortPlaces]);

  const listPlaces = useMemo(
    () => (layer === "favorites" ? sortPlaces(fav.placesIn(favGroupId)) : resultPlaces),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer, favGroupId, fav.items, resultPlaces, sortPlaces],
  );

  // ----- 맛집 카드 (지도 아래 좌우로 넘기기): 추천 결과·저장 리스트 모두 -----
  // 검색하면 바로 뜨고, 지도에서 가게를 누르면 그 가게 카드가 뜬다. 카드를 누르면 상세 전체 화면
  const [cardsOpen, setCardsOpen] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const carouselRef = useRef<PlaceCarouselRef>(null);
  const showCards = cardsOpen && listPlaces.length > 0 && snap === "closed" && !searchOpen && (layer === "favorites" || !!results);
  const cardPlace = showCards ? (listPlaces[cardIndex] ?? null) : null;
  // AI 정렬·정렬 방식이 바뀌어도 보고 있던 가게 카드에 머문다
  const cardPlaceId = useRef<string | null>(null);
  useEffect(() => {
    const i = cardPlaceId.current ? listPlaces.findIndex((p) => p.id === cardPlaceId.current) : -1;
    setCardIndex(i >= 0 ? i : 0);
  }, [listPlaces]);
  useEffect(() => {
    cardPlaceId.current = listPlaces[cardIndex]?.id ?? null;
  }, [cardIndex, listPlaces]);
  const closeCards = () => {
    setCardsOpen(false);
    if (layer === "results") {
      setResults(null);
      setActiveThemeIds([]);
    }
  };
  // 카드를 넘기면 지도도 그 가게로
  const lastPanned = useRef<string | null>(null);
  useEffect(() => {
    if (!cardPlace || lastPanned.current === cardPlace.id) return;
    const first = lastPanned.current === null;
    lastPanned.current = cardPlace.id;
    if (!first) mapRef.current?.pan(cardPlace.lat, cardPlace.lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardPlace?.id]);
  useEffect(() => {
    lastPanned.current = null; // 새 검색·다른 리스트면 처음엔 전체 보기
  }, [results?.id, layer, favGroupId]);
  // 타임라인 등 목록 밖에서 연 식당도 지도에 보이게
  const mapPlaces =
    sheet.mode === "detail" && snap !== "closed" && !listPlaces.some((p) => p.id === sheet.place.id) ? [...listPlaces, sheet.place] : listPlaces;

  const sortBar = (
    <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 10 }}>
      {SORTS.map((o) => {
        const on = sortMode === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => setSortMode(o.id)}
            style={{ paddingHorizontal: 11, height: 30, borderRadius: 15, justifyContent: "center", borderWidth: 1, borderColor: on ? c.text : c.line, backgroundColor: on ? c.text : c.surface }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={{ fontSize: 12, fontWeight: on ? "700" : "500", color: on ? c.bg : c.text }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  const selectedId = snap !== "closed" && sheet.mode === "detail" ? sheet.place.id : (cardPlace?.id ?? null);
  const favGroupColor = favGroupId ? fav.groups.find((g) => g.id === favGroupId)?.color : null;

  /** 더 보기: 지금 결과 뒤에 다음 가게들을 이어 붙인다 (지도 번호·카드도 이어서) */
  const loadMore = async (fromCards = false) => {
    const r = results;
    if (!r?.more || !r.hasMore || r.loadingMore) return;
    setResults((prev) => (prev && prev.id === r.id ? { ...prev, loadingMore: true } : prev));
    try {
      let add: ScoredPlace[] = [];
      let hasMore = false;
      let more: MoreSource = r.more;
      if (more.kind === "db") {
        const d = await searchDb({ ...more.req, offset: r.places.length });
        add = d.places;
        hasMore = !!d.hasMore;
      } else if (more.kind === "live") {
        const res = await fetchRecommendations({ ...more.req, page: more.page + 1, exclude: r.places.map((p) => p.id) });
        add = res.places;
        hasMore = !!res.hasMore;
        more = { ...more, page: more.page + 1 };
      } else {
        const places = await rg.loadPlaces(more.regionId);
        const upto = r.places.length + REGION_PAGE;
        const ranked = more.q ? rankByText(places, more.q, me, upto + 1) : rankByTheme(places, more.theme!, me, upto + 1);
        add = ranked.slice(r.places.length, upto);
        hasMore = ranked.length > upto;
      }
      // 카드 끝 '더 보기'에서 불렀으면 새로 붙은 첫 가게 카드로 넘어간다
      if (fromCards) {
        const had = new Set(r.places.map((p) => p.id));
        const first = add.find((p) => !had.has(p.id));
        if (first) cardPlaceId.current = first.id;
      }
      setResults((prev) => {
        if (!prev || prev.id !== r.id) return prev;
        const seen = new Set(prev.places.map((p) => p.id));
        const fresh = add.filter((p) => !seen.has(p.id));
        return { ...prev, places: [...prev.places, ...fresh], more, hasMore: hasMore && fresh.length > 0, loadingMore: false };
      });
    } catch (e) {
      setResults((prev) => (prev && prev.id === r.id ? { ...prev, loadingMore: false } : prev));
      Alert.alert("더 불러오지 못했어요", e instanceof Error ? e.message : "잠시 후 다시 시도해 주세요.");
    }
  };

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
    const searchId = ++searchSeq.current;
    try {
      let next: Results;
      if (source.kind === "nearby") {
        if (loc.status === "locating") return;
        const radiusText = formatRadius(radius);
        // 1) 서버 DB에 이 근처를 분석해 둔 데이터가 충분하면 바로 (빠르고, 분류값이 정확함)
        const dbReq = { lat: loc.lat, lng: loc.lng, radius, theme: theme && !q ? themeDef(theme) : null, q: q || null };
        const db = await searchDb(dbReq).catch(() => null);
        if (db && db.analyzed >= 30 && db.places.length >= 8) {
          next = {
            id: searchId,
            places: db.places,
            title: q || theme!.label,
            subtitle: `내 주변 ${radiusText} · 저장된 ${db.inArea.toLocaleString()}곳 중 (분석 ${db.analyzed.toLocaleString()}곳)`,
            warnings: [],
            more: { kind: "db", req: dbReq },
            hasMore: !!db.hasMore,
          };
        } else {
          // 2) 아니면 실시간 (카카오 검색 + 리뷰 수집)
          //    빠른 결과를 먼저 보여주고, AI 정렬은 뒤에서 이어서 반영
          const liveReq = {
            lat: loc.lat,
            lng: loc.lng,
            radius,
            presetId: theme?.ids?.length === 1 ? theme.ids[0] : null,
            theme: theme ? themeDef(theme) : null,
            text: q || null,
            fast: true,
          };
          const res = await fetchRecommendations(liveReq);
          next = {
            id: searchId,
            places: res.places,
            title: res.query.summary,
            subtitle: `내 주변 ${radiusText} · 실시간 · 검색어 ${res.query.keywords.join(", ")}`,
            warnings: res.warnings,
            aiPending: res.aiPending,
            more: { kind: "live", req: liveReq, page: 1 },
            hasMore: !!res.hasMore && res.places.length > 0,
          };
          if (res.aiPending) {
            rerankRecommendations(res.query, res.places)
              .then((r) => setResults((prev) => (prev && prev.id === searchId ? { ...prev, places: r.places, aiPending: false } : prev)))
              .catch(() => setResults((prev) => (prev && prev.id === searchId ? { ...prev, aiPending: false } : prev)));
          }
        }
      } else {
        const region = source.region;
        const places = await rg.loadPlaces(region.id);
        const pr = rg.progress[region.id];
        const ranked = q ? rankByText(places, q, me, REGION_PAGE + 1) : rankByTheme(places, theme!, me, REGION_PAGE + 1);
        const warnings: string[] = [];
        if (!places.length) warnings.push("아직 이 지역 맛집을 모으는 중이에요. 설정에서 진행 상황을 볼 수 있어요.");
        else if (pr && pr.phase !== "done") warnings.push(`수집 중이라 ${pr.detailed}/${pr.target}곳만 분석됐어요. 끝나면 더 정확해져요.`);
        next = {
          id: searchId,
          places: ranked.slice(0, REGION_PAGE),
          title: `${region.name} · ${q || theme!.label}`,
          subtitle: `미리 수집한 ${places.length}곳에서`,
          warnings,
          more: { kind: "region", regionId: region.id, theme, q },
          hasMore: ranked.length > REGION_PAGE,
        };
      }
      if (next.places.length === 0 && !next.warnings.length) next.warnings.push("조건에 맞는 곳이 없어요. 다른 주제나 검색어로 찾아보세요.");
      setResults(next);
      setLayer("results");
      cardPlaceId.current = null;
      setCardIndex(0);
      if (next.places.length) {
        // 결과는 지도 아래 카드로 (목록은 "리스트로 보기")
        setCardsOpen(true);
        setSheet({ mode: "results" });
        setSnap("closed");
        setSearchOpen(false);
      } else showList({ mode: "results" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "추천을 불러오지 못했어요.";
      setError(msg);
      setResults({ id: searchId, places: [], title: "검색 실패", warnings: [msg] });
      showList({ mode: "results" });
    } finally {
      setLoading(false);
    }
  };

  /** 상단 주제 칩: 누르면 넣거나 빼고, 고른 주제를 모두 만족하는 곳으로 다시 찾는다 */
  const pickTheme = (t: ThemePreset) => {
    const next = activeThemeIds.includes(t.id) ? activeThemeIds.filter((x) => x !== t.id) : [...activeThemeIds, t.id];
    setActiveThemeIds(next);
    setPanelThemeIds(next);
    setText("");
    const theme = th.combine(next);
    if (theme) runSearch({ theme });
  };

  /** 상단 검색창: 가게 이름이 확실히 맞는 곳이 있으면 그 가게들을, 아니면 메뉴·분위기 추천 */
  const submitText = async () => {
    setActiveThemeIds([]);
    const q = text.trim();
    if (q.length >= 2 && source.kind === "nearby" && loc.status !== "locating") {
      setLoading(true);
      const searchId = ++searchSeq.current;
      const r = await searchByName(q, loc.lat, loc.lng).catch(() => null);
      if (searchId !== searchSeq.current) return; // 그 사이 다른 검색
      if (r?.strong && r.places.length) {
        setLoading(false);
        setResults({
          id: searchId,
          places: r.places,
          title: `'${q}' 검색`,
          subtitle: `가게 이름이 맞는 곳 ${r.places.length}곳 · 가까운 순`,
          warnings: [],
        });
        setLayer("results");
        cardPlaceId.current = null;
        setCardIndex(0);
        setCardsOpen(true);
        setSheet({ mode: "results" });
        setSnap("closed");
        setSearchOpen(false);
        return;
      }
    }
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
    const theme = th.combine(activeThemeIds);
    if (theme) runSearch({ theme });
    else if (text.trim()) runSearch({ text });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const openDetail = useCallback(
    (place: ScoredPlace, back: ListMode | null, opts?: { full?: boolean }) => {
      setSheet({ mode: "detail", place, back });
      setSnap((s) => (opts?.full ? "full" : s === "full" && back ? "full" : "half"));
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
    setCardsOpen(false);
    setLayer("favorites");
    setFavGroupId(null);
    setFavEditing(false);
    showList({ mode: "favGroups" });
  };

  // 안드로이드 뒤로가기
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (webTarget || settingsOpen || savePlace || timelineOpen || themeEditorOpen) return false;
      if (searchOpen) {
        setSearchOpen(false);
        return true;
      }
      if (snap !== "closed") {
        goBack();
        return true;
      }
      if (showCards) {
        closeCards();
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
          // 저장 리스트도 지도 아래 카드로 (빈 리스트면 목록 화면 그대로)
          if (fav.placesIn(gid).length > 0) {
            cardPlaceId.current = null;
            setCardIndex(0);
            setCardsOpen(true);
            setSnap("closed");
          } else sheetRef.current?.scrollToTop();
        }}
      />
    );
  } else if (sheet.mode === "favList") {
    const g = sheet.groupId ? fav.groups.find((x) => x.id === sheet.groupId) : null;
    const places = sortPlaces(fav.placesIn(sheet.groupId));
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
    header = (
      <View>
        {header}
        {sortBar}
      </View>
    );
    body = (
      <PlaceList
        places={places}
        colors={c}
        distanceOf={distanceOf}
        onPick={(p) => {
          const i = listPlaces.findIndex((x) => x.id === p.id);
          if (i >= 0) setCardIndex(i);
          openDetail(p, listBack({ mode: "favList", groupId: sheet.groupId }));
        }}
        numbered={false}
        badgeColor={(p) => colorHex(fav.colorOf(p.id) ?? "red")}
        emptyText="이 리스트에 저장한 식당이 없어요."
      />
    );
  } else {
    header = (
      <View>
        <ListHeader
          title={results?.title ?? "추천 결과"}
          subtitle={results?.aiPending ? `${results.subtitle ?? ""} · AI가 리뷰를 읽고 순서를 다듬는 중…` : results?.subtitle}
          colors={c}
          onClose={() => setSnap("closed")}
        />
        {sortBar}
      </View>
    );
    body = (
      <PlaceList
        places={resultPlaces}
        colors={c}
        distanceOf={distanceOf}
        onPick={(p) => {
          const i = listPlaces.findIndex((x) => x.id === p.id);
          if (i >= 0) setCardIndex(i);
          openDetail(p, { mode: "results" });
        }}
        numbered
        notices={results?.warnings}
        emptyText="추천 결과가 없어요."
        footer={
          results?.hasMore ? (
            <Pressable
              onPress={() => loadMore()}
              disabled={results.loadingMore}
              style={{ margin: 16, borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingVertical: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
              accessibilityRole="button"
            >
              {results.loadingMore ? <ActivityIndicator color={c.accent} size="small" /> : null}
              <Text style={{ color: c.text, fontSize: 14, fontWeight: "700" }}>{results.loadingMore ? "더 불러오는 중…" : `더 보기 (지금 ${results.places.length}곳)`}</Text>
            </Pressable>
          ) : results && results.places.length >= 20 ? (
            <Text style={{ textAlign: "center", color: c.muted, fontSize: 12, paddingVertical: 16 }}>조건에 맞는 곳을 모두 보여드렸어요. ({results.places.length}곳)</Text>
          ) : null
        }
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
        iconsReady={iconsReady}
        onSelect={(p) => {
          // 지도에서 가게를 누르면 그 가게 카드 팝업 (열려 있던 시트는 닫는다). 카드를 누르면 상세 전체 화면
          const i = listPlaces.findIndex((x) => x.id === p.id);
          if (i >= 0) {
            setCardIndex(i);
            setCardsOpen(true);
            setSearchOpen(false);
            setSnap("closed");
          } else openDetail(p, null);
        }}
        onTapMap={() => snap === "half" && setSnap("closed")}
        padding={{ top: topArea, bottom: snap === "half" ? Math.round(H * HALF_RATIO) : showCards ? CARD_HEIGHT + insets.bottom + 70 : 0 }}
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
          themes={th.visible}
          activeThemeIds={activeThemeIds}
          onEditThemes={() => setThemeEditorOpen(true)}
          onPickTheme={pickTheme}
          onOpenSettings={() => setSettingsOpen(true)}
          settingsBadge={updateAvailable}
        />
      )}

      {/* 2. 하단: 저장(즐겨찾기) · 맛집추천 · 내 위치 */}
      {snap === "closed" && !searchOpen && !showCards && (
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
      {/* 내 타임라인 (내 위치 버튼 위) */}
      {snap === "closed" && !searchOpen && !showCards && (
        <Pressable
          style={[styles.round, styles.timelineBtn, { bottom: insets.bottom + 20 + 58, backgroundColor: c.surface }]}
          onPress={() => setTimelineOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="내 타임라인"
        >
          {iconsReady ? <MaterialCommunityIcons name="timeline-text-outline" size={22} color={c.text} /> : <Text style={{ fontSize: 16 }}>🕘</Text>}
        </Pressable>
      )}
      {/* 결과 카드: 좌우로 넘기면 지도에서 그 가게가 선택된다 */}
      {showCards && (
        <>
          <View style={[styles.cardBar, { bottom: insets.bottom + 12 + CARD_HEIGHT + 10 }]} pointerEvents="box-none">
            <Pressable
              style={[styles.pill, { backgroundColor: c.surface }]}
              onPress={() => showList(layer === "favorites" ? { mode: "favList", groupId: favGroupId } : { mode: "results" })}
              accessibilityRole="button"
              accessibilityLabel="리스트로 보기"
            >
              <Text style={{ fontSize: 15, color: c.accent, fontWeight: "800" }}>☰</Text>
              <Text style={{ fontSize: 14, fontWeight: "700", color: c.text, maxWidth: 170 }} numberOfLines={1}>
                {layer === "favorites" ? `${favGroupId ? (fav.groups.find((g) => g.id === favGroupId)?.name ?? "저장") : "전체"} 목록` : "리스트로 보기"}
              </Text>
              <Text style={{ fontSize: 13, color: c.muted }}>{`${cardIndex + 1}/${listPlaces.length}`}</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
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
            <Pressable
              style={[styles.round, { backgroundColor: c.surface }]}
              onPress={closeCards}
              accessibilityRole="button"
              accessibilityLabel={layer === "favorites" ? "카드 닫기" : "추천 결과 닫기"}
            >
              <Text style={{ fontSize: 17, color: c.text }}>✕</Text>
            </Pressable>
          </View>
          {layer === "results" && !!results?.warnings.length && (
            <Pressable onPress={() => showList({ mode: "results" })} style={[styles.cardNotice, { bottom: insets.bottom + 12 + CARD_HEIGHT + 70, backgroundColor: c.warnBg }]}>
              <Text style={{ color: c.warnText, fontSize: 12 }} numberOfLines={1}>
                {results.warnings[0]}
              </Text>
            </Pressable>
          )}
          <View style={[styles.cards, { bottom: insets.bottom + 12 }]}>
            <PlaceCarousel
              ref={carouselRef}
              places={listPlaces}
              numbered={layer === "results"}
              index={cardIndex}
              onIndexChange={setCardIndex}
              onOpen={(p) => openDetail(p, null, { full: true })}
              distanceOf={distanceOf}
              colors={c}
              iconsReady={iconsReady}
              // 추천 결과 끝: 더 보기 카드 (넘겨서 닿으면 자동으로 불러온다)
              more={layer === "results" && results?.hasMore ? { loading: !!results.loadingMore, onLoad: () => loadMore(true) } : undefined}
            />
          </View>
        </>
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
          presets={th.visible}
          selectedIds={panelThemeIds}
          onToggle={(id) => setPanelThemeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))}
          onEditThemes={() => setThemeEditorOpen(true)}
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
            const theme = th.combine(panelThemeIds) ?? null;
            setActiveThemeIds(panelText.trim() ? [] : panelThemeIds);
            setText(panelText);
            runSearch({ theme, text: panelText });
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}

      <ThemeEditor visible={themeEditorOpen} onClose={() => setThemeEditorOpen(false)} colors={c} />
      <TimelineScreen
        visible={timelineOpen}
        onClose={() => setTimelineOpen(false)}
        onOpenPlace={(snapPlace) => openDetail(snapToScored(snapPlace), null)}
        colors={c}
        me={me}
      />
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
  timelineBtn: { position: "absolute", right: 12 },
  cardBar: { position: "absolute", left: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  cards: { position: "absolute", left: 0, right: 0, height: CARD_HEIGHT + 16, paddingTop: 4 },
  cardNotice: { position: "absolute", left: 16, right: 16, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  listBtn: { position: "absolute", alignSelf: "center", height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center", ...shadow },
});
