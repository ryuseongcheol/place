import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import SafeImage from "./SafeImage";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { formatDistance } from "./PlaceDetailView";
import { useDetail } from "./detailCache";
import { useMyNotes } from "./myNotes";
import { categoryIcon, showLabel } from "./shared";
import type { Colors } from "./theme";
import type { ScoredPlace } from "./types";

/** 카드 높이 (지도 여백 계산용) */
export const CARD_HEIGHT = 248;
const GAP = 10;
const SIDE = 20;

export interface PlaceCarouselRef {
  scrollTo: (index: number, animated?: boolean) => void;
}

interface Props {
  places: ScoredPlace[];
  index: number;
  /** 넘겨서 보이는 카드가 바뀔 때 */
  onIndexChange: (i: number) => void;
  onOpen: (p: ScoredPlace) => void;
  distanceOf: (p: ScoredPlace) => number | null;
  colors: Colors;
  iconsReady?: boolean;
  /** 추천 순위 번호 붙이기 (저장 리스트는 번호 없이) */
  numbered?: boolean;
  /** 끝에 '더 보기' 카드 (넘겨서 닿거나 누르면 다음 가게들을 불러온다) */
  more?: { loading: boolean; onLoad: () => void };
}

/** 지도 아래 맛집 카드: 좌우로 넘기면 지도에서 그 가게가 선택된다 */
const PlaceCarousel = forwardRef<PlaceCarouselRef, Props>(function PlaceCarousel({ places, index, onIndexChange, onOpen, distanceOf, colors: c, iconsReady, numbered = true, more }, ref) {
  const { width } = useWindowDimensions();
  const cardW = width - SIDE * 2;
  const step = cardW + GAP;
  const listRef = useRef<FlatList<ScoredPlace>>(null);
  const shown = useRef(index);

  /** 코드로 넘기는 중인 목적지 카드 (지나가는 카드마다 지도가 따라 움직이지 않게, 도착할 때까지 중간 위치는 무시) */
  const target = useRef<number | null>(null);
  const targetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTo = (i: number, animated = true) => {
    shown.current = i;
    target.current = animated ? i : null;
    if (targetTimer.current) clearTimeout(targetTimer.current);
    // 끝까지 못 가는 경우(목록 끝 등)에도 풀리게
    if (animated) targetTimer.current = setTimeout(() => (target.current = null), 900);
    listRef.current?.scrollToOffset({ offset: i * step, animated });
  };
  useImperativeHandle(ref, () => ({ scrollTo }));

  // 바깥(지도 마커)에서 고른 카드로 이동
  useEffect(() => {
    if (index !== shown.current) scrollTo(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastX = useRef(0);
  // 더 보기로 가게가 늘어나면, '더 보기' 카드 자리에 온 새 가게를 지금 카드로 알린다 (지도도 그 가게로)
  const prevLen = useRef(places.length);
  useEffect(() => {
    const before = prevLen.current;
    prevLen.current = places.length;
    // 늘어났고, 직전에 '더 보기' 카드(옛 목록의 끝 다음 칸)에 있었을 때만
    if (places.length <= before || Math.round(lastX.current / step) !== before) return;
    shown.current = before;
    onIndexChange(before);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places.length]);
  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
    if (targetTimer.current) clearTimeout(targetTimer.current);
  }, []);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    if (target.current !== null) {
      if (Math.abs(x - target.current * step) < 2) target.current = null;
      return;
    }
    lastX.current = x;
    const raw = Math.round(x / step);
    // 끝의 '더 보기' 카드까지 넘기면 자동으로 불러온다 (그 자리에 머물다가 새 가게 카드로 바뀐다)
    if (more && !more.loading && raw >= places.length) more.onLoad();
    const snapI = Math.max(0, Math.min(places.length - (more ? 0 : 1), raw));
    const i = Math.min(snapI, places.length - 1);
    if (i !== shown.current) {
      shown.current = i;
      onIndexChange(i);
    }
    // 멈춘 자리가 카드 경계가 아니면 가까운 카드에 맞춘다 (안드로이드는 snapToInterval 로 이미 맞음)
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      if (Math.abs(x - snapI * step) > 1) listRef.current?.scrollToOffset({ offset: snapI * step, animated: true });
    }, 160);
  };

  return (
    <FlatList
      ref={listRef}
      data={places}
      keyExtractor={(p) => p.id}
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={step}
      snapToAlignment="start"
      decelerationRate="fast"
      disableIntervalMomentum
      contentContainerStyle={{ paddingHorizontal: SIDE, gap: GAP }}
      getItemLayout={(_, i) => ({ length: step, offset: step * i, index: i })}
      initialScrollIndex={Math.min(index, Math.max(0, places.length - 1))}
      onScroll={onScroll}
      onScrollBeginDrag={() => (target.current = null)}
      scrollEventThrottle={32}
      windowSize={5}
      ListFooterComponent={
        more ? (
          <Pressable onPress={more.onLoad} disabled={more.loading} style={[styles.card, styles.moreCard, { width: cardW, backgroundColor: c.surface }]} accessibilityRole="button" accessibilityLabel="결과 더 보기">
            {more.loading ? <ActivityIndicator color={c.accent} /> : <Text style={{ fontSize: 28, color: c.accent }}>＋</Text>}
            <Text style={{ fontSize: 15, fontWeight: "700", color: c.text, marginTop: 8 }}>{more.loading ? "더 불러오는 중…" : "더 보기"}</Text>
            <Text style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>지금 {places.length}곳 · 다음 가게들을 이어서 보여드려요</Text>
          </Pressable>
        ) : undefined
      }
      renderItem={({ item, index: i }) => (
        <PlaceCard place={item} rank={numbered ? i + 1 : null} width={cardW} near={Math.abs(i - index) <= 1} distance={distanceOf(item)} onPress={() => onOpen(item)} colors={c} iconsReady={iconsReady} />
      )}
    />
  );
});

export default PlaceCarousel;

function PlaceCard({
  place: p,
  rank,
  width,
  near,
  distance,
  onPress,
  colors: c,
  iconsReady,
}: {
  place: ScoredPlace;
  rank: number | null;
  width: number;
  /** 보이는 카드와 그 옆 카드만 사진을 불러온다 */
  near: boolean;
  distance: number | null;
  onPress: () => void;
  colors: Colors;
  iconsReady?: boolean;
}) {
  const { detail, loading } = useDetail(p, near);
  const notes = useMyNotes();
  const mine = notes.get(p.id);
  const category = p.category.split(">").slice(-1)[0]?.trim();
  const ic = categoryIcon(p.category, p.name);
  const photos = (detail?.photos ?? []).slice(0, 3);
  const quote = p.kakao?.snippets?.find((s) => s.trim().length > 8) ?? detail?.kakaoReviews?.find((r) => r.text.trim().length > 8)?.text ?? null;
  const chips = [
    ...(p.shows ?? []).map((s) => ({ text: showLabel(s), tone: "show" as const })),
    ...p.highlights.slice(0, 3).map((h) => ({ text: h, tone: "plain" as const })),
  ];

  return (
    <Pressable onPress={onPress} style={[styles.card, { width, backgroundColor: c.surface }]} accessibilityRole="button" accessibilityLabel={`${rank != null ? `${rank}. ` : ""}${p.name} 상세 보기`}>
      <View style={styles.head}>
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          {rank != null ? <Text style={{ color: c.muted }}>{rank}. </Text> : null}
          {p.name}
        </Text>
        {p.score > 0 && <Text style={{ fontSize: 15, fontWeight: "800", color: c.accent }}>{p.score}점</Text>}
        {p.kakao?.rating != null && (
          <Text style={{ fontSize: 14, color: c.text }}>
            <Text style={{ color: c.muted }}> · </Text>
            <Text style={{ color: "#F5A400" }}>★</Text> {p.kakao.rating.toFixed(1)}
            <Text style={{ color: c.muted, fontSize: 13 }}> ({p.kakao.ratingCount.toLocaleString()})</Text>
          </Text>
        )}
      </View>

      <View style={styles.chips}>
        {!!category && (
          <Text style={[styles.chip, { backgroundColor: c.accentSoft, color: c.accent, fontWeight: "700" }]} numberOfLines={1}>
            {category}
          </Text>
        )}
        {mine?.rating ? <Text style={[styles.chip, { backgroundColor: "#FFF4D6", color: "#9A6B00", fontWeight: "700" }]}>내 ★{mine.rating}</Text> : null}
        {chips.map((ch) => (
          <Text
            key={ch.text}
            style={[styles.chip, ch.tone === "show" ? { backgroundColor: c.errorBg, color: c.errorText, fontWeight: "700" } : { backgroundColor: c.surface2, color: c.text }]}
            numberOfLines={1}
          >
            {ch.text}
          </Text>
        ))}
      </View>

      <View style={styles.photos}>
        {photos.length > 0
          ? photos.map((u, i) => (
              <SafeImage
                key={u}
                size={120}
                source={{ uri: u }}
                style={[styles.photo, { backgroundColor: c.surface2 }, i === 0 && styles.photoFirst, i === photos.length - 1 && styles.photoLast]}
                contentFit="cover"
                transition={150}
              />
            ))
          : (
            <View style={[styles.photo, styles.photoFirst, styles.photoLast, styles.noPhoto, { backgroundColor: c.surface2 }]}>
              {iconsReady ? <MaterialCommunityIcons name={ic.glyph as never} size={30} color={c.line} /> : null}
              <Text style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>{loading || !near ? "사진 불러오는 중…" : "사진이 없어요"}</Text>
            </View>
          )}
        {distance != null && (
          <View style={styles.distance}>
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>📍 {formatDistance(distance)}</Text>
          </View>
        )}
      </View>

      <Text style={[styles.quote, { color: quote ? c.text : c.muted }]} numberOfLines={2}>
        {quote ? `“${quote.trim()}”` : p.reason}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    height: CARD_HEIGHT,
    borderRadius: 18,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  moreCard: { alignItems: "center", justifyContent: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { flex: 1, fontSize: 18, fontWeight: "800", letterSpacing: -0.3, marginRight: 6 },
  chips: { flexDirection: "row", gap: 6, marginTop: 10, overflow: "hidden", height: 26 },
  chip: { fontSize: 12, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 13, overflow: "hidden" },
  photos: { flexDirection: "row", gap: 2, marginTop: 10, height: 104 },
  photo: { flex: 1, height: 104 },
  photoFirst: { borderTopLeftRadius: 12, borderBottomLeftRadius: 12 },
  photoLast: { borderTopRightRadius: 12, borderBottomRightRadius: 12 },
  noPhoto: { alignItems: "center", justifyContent: "center" },
  distance: { position: "absolute", right: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 },
  quote: { fontSize: 14, lineHeight: 20, marginTop: 10 },
});
