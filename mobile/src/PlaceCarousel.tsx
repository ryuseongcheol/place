import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Image } from "expo-image";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
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
}

/** 지도 아래 맛집 카드: 좌우로 넘기면 지도에서 그 가게가 선택된다 */
const PlaceCarousel = forwardRef<PlaceCarouselRef, Props>(function PlaceCarousel({ places, index, onIndexChange, onOpen, distanceOf, colors: c, iconsReady }, ref) {
  const { width } = useWindowDimensions();
  const cardW = width - SIDE * 2;
  const step = cardW + GAP;
  const listRef = useRef<FlatList<ScoredPlace>>(null);
  const shown = useRef(index);

  const scrollTo = (i: number, animated = true) => {
    shown.current = i;
    listRef.current?.scrollToOffset({ offset: i * step, animated });
  };
  useImperativeHandle(ref, () => ({ scrollTo }));

  // 바깥(지도 마커)에서 고른 카드로 이동
  useEffect(() => {
    if (index !== shown.current) scrollTo(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.max(0, Math.min(places.length - 1, Math.round(x / step)));
    if (i !== shown.current) {
      shown.current = i;
      onIndexChange(i);
    }
    // 멈춘 자리가 카드 경계가 아니면 가까운 카드에 맞춘다 (안드로이드는 snapToInterval 로 이미 맞음)
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      if (Math.abs(x - i * step) > 1) listRef.current?.scrollToOffset({ offset: i * step, animated: true });
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
      scrollEventThrottle={32}
      windowSize={5}
      renderItem={({ item, index: i }) => (
        <PlaceCard place={item} rank={i + 1} width={cardW} near={Math.abs(i - index) <= 1} distance={distanceOf(item)} onPress={() => onOpen(item)} colors={c} iconsReady={iconsReady} />
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
  rank: number;
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
    <Pressable onPress={onPress} style={[styles.card, { width, backgroundColor: c.surface }]} accessibilityRole="button" accessibilityLabel={`${rank}. ${p.name} 상세 보기`}>
      <View style={styles.head}>
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          <Text style={{ color: c.muted }}>{rank}. </Text>
          {p.name}
        </Text>
        <Text style={{ fontSize: 15, fontWeight: "800", color: c.accent }}>{p.score}점</Text>
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
              <Image
                key={u}
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
