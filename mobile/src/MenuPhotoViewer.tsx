import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MenuItem } from "./types";

/** 사진 없는 메뉴의 기본 배경 */
export interface MenuFallback {
  /** 가게 대표 사진 (흐리게 깔아 둔다). 없으면 단색 */
  image?: string | null;
  /** 가게 종류 아이콘 (MaterialCommunityIcons 이름) */
  glyph?: string | null;
}

/**
 * 메뉴 크게 보기: 사진을 배경(흐리게 꽉 채움) + 가운데 원본 사진, 아래에 메뉴 이름·가격.
 * 사진 없는 메뉴는 기본 배경(가게 사진을 흐리게, 없으면 단색) 위에 가게 종류 아이콘.
 * 좌우로 넘기거나 ‹ › 버튼으로 이전·다음 메뉴.
 */
export default function MenuPhotoViewer({
  menus,
  index,
  placeName,
  fallback,
  onClose,
}: {
  menus: MenuItem[];
  /** 열 메뉴 (null 이면 닫힘) */
  index: number | null;
  placeName: string;
  fallback?: MenuFallback;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<MenuItem>>(null);
  const [i, setI] = useState(index ?? 0);

  useEffect(() => {
    if (index != null) setI(index);
  }, [index]);

  const go = (k: number) => {
    const n = Math.max(0, Math.min(menus.length - 1, k));
    setI(n);
    listRef.current?.scrollToOffset({ offset: n * width, animated: true });
  };
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const n = Math.round(e.nativeEvent.contentOffset.x / width);
    if (n !== i) setI(Math.max(0, Math.min(menus.length - 1, n)));
  };

  if (index == null) return null;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <FlatList
          ref={listRef}
          data={menus}
          keyExtractor={(m, k) => `${m.name}-${k}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={Math.min(index, menus.length - 1)}
          getItemLayout={(_, k) => ({ length: width, offset: width * k, index: k })}
          onMomentumScrollEnd={onScrollEnd}
          onScrollEndDrag={onScrollEnd}
          windowSize={3}
          renderItem={({ item }) => <Slide item={item} fallback={fallback} width={width} height={height} top={insets.top} bottom={insets.bottom} />}
        />

        {/* 위: 닫기 · 가게 이름 · n/N */}
        <View style={[styles.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={12} style={styles.round} accessibilityRole="button" accessibilityLabel="닫기">
            <Text style={styles.roundText}>✕</Text>
          </Pressable>
          <Text style={styles.place} numberOfLines={1}>
            {placeName}
          </Text>
          <View style={styles.counter}>
            <Text style={styles.counterText}>
              {i + 1} / {menus.length}
            </Text>
          </View>
        </View>

        {/* 이전·다음 */}
        {i > 0 && (
          <Pressable onPress={() => go(i - 1)} hitSlop={10} style={[styles.side, { left: 10, top: height / 2 - 28 }]} accessibilityRole="button" accessibilityLabel="이전 메뉴">
            <Text style={styles.sideText}>‹</Text>
          </Pressable>
        )}
        {i < menus.length - 1 && (
          <Pressable onPress={() => go(i + 1)} hitSlop={10} style={[styles.side, { right: 10, top: height / 2 - 28 }]} accessibilityRole="button" accessibilityLabel="다음 메뉴">
            <Text style={styles.sideText}>›</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

function Slide({ item, fallback, width, height, top, bottom }: { item: MenuItem; fallback?: MenuFallback; width: number; height: number; top: number; bottom: number }) {
  const [failed, setFailed] = useState(false);
  const [bgFailed, setBgFailed] = useState(false);
  const photo = item.image && !failed ? item.image : null;
  // 배경: 메뉴 사진, 없으면 가게 대표 사진 (둘 다 흐리게 꽉 채움), 그것도 없으면 단색
  const bg = photo ?? (fallback?.image && !bgFailed ? fallback.image : null);
  const area = { position: "absolute" as const, left: 0, right: 0, top: top + 64, bottom: bottom + 150 };
  return (
    <View style={{ width, height, backgroundColor: "#3B2A20" }}>
      {bg && <Image source={{ uri: bg }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={photo ? 28 : 40} onError={() => !photo && setBgFailed(true)} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: photo ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.55)" }]} />
      {/* 가운데: 잘리지 않은 원본, 사진이 없으면 기본 그림 */}
      {photo ? (
        <Image source={{ uri: photo }} style={area} contentFit="contain" transition={150} onError={() => setFailed(true)} accessibilityLabel={`${item.name} 사진`} />
      ) : (
        <View style={[area, styles.noPhoto]}>
          <View style={styles.placeholder}>
            <MaterialCommunityIcons name={(fallback?.glyph ?? "silverware-fork-knife") as never} size={64} color="rgba(255,255,255,0.85)" />
          </View>
          <Text style={styles.placeholderText}>{item.image ? "사진을 불러오지 못했어요" : "사진이 없는 메뉴예요"}</Text>
        </View>
      )}
      {/* 아래: 메뉴 이름·가격 (사진 위에 어둡게 깔고) */}
      <View style={[styles.caption, { paddingBottom: bottom + 28 }]}>
        {/* 위로 갈수록 옅어지는 그늘 (그라데이션 대신 띠 여러 개) */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {FADE.map((a, k) => (
            <View key={k} style={{ height: k === FADE.length - 1 ? undefined : 7, flex: k === FADE.length - 1 ? 1 : undefined, backgroundColor: `rgba(0,0,0,${a})` }} />
          ))}
        </View>
        <Text style={styles.name}>{item.name}</Text>
        {item.price ? <Text style={styles.price}>{item.price}</Text> : null}
      </View>
    </View>
  );
}

const FADE = [0.04, 0.08, 0.13, 0.18, 0.24, 0.3, 0.36, 0.42, 0.5];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  top: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 10 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  roundText: { color: "#fff", fontSize: 18 },
  place: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  counter: { backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 14, paddingHorizontal: 11, paddingVertical: 5 },
  counterText: { color: "#fff", fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  side: { position: "absolute", width: 44, height: 56, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  sideText: { color: "#fff", fontSize: 34, lineHeight: 38, marginTop: -4 },
  noPhoto: { alignItems: "center", justifyContent: "center" },
  placeholder: { width: 132, height: 132, borderRadius: 66, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  placeholderText: { marginTop: 14, color: "rgba(255,255,255,0.75)", fontSize: 14 },
  caption: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 22, paddingTop: 72 },
  name: { color: "#fff", fontSize: 24, fontWeight: "800", letterSpacing: -0.4, lineHeight: 31 },
  price: { color: "#FFD166", fontSize: 19, fontWeight: "800", marginTop: 6 },
});
