import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ScrollViewInstance,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Colors } from "./theme";

export type SheetSnap = "half" | "full" | "closed";

export interface BottomSheetRef {
  scrollToTop: () => void;
}

interface Props {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** 항상 보이고 끌 수 있는 상단 영역 (손잡이 아래) */
  header: ReactNode;
  children: ReactNode;
  colors: Colors;
  /** 반 팝업일 때 화면에서 차지하는 비율 */
  halfRatio?: number;
}

/**
 * 네이버 지도식 바텀시트.
 * - 반 팝업에서 위로 끌면 전체, 전체에서 (내용이 맨 위일 때) 아래로 끌면 반 팝업, 더 내리면 닫힘
 * - 반 팝업에서는 내용 스크롤을 막고 시트 자체가 움직인다
 * 외부 라이브러리 없이 RN 기본 Animated + PanResponder로 구현.
 */
const BottomSheet = forwardRef<BottomSheetRef, Props>(function BottomSheet(
  { snap, onSnapChange, header, children, colors, halfRatio = 0.45 },
  ref,
) {
  const { height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const fullY = insets.top;
  const halfY = Math.round(H * (1 - halfRatio));
  const closedY = H;
  const posOf = (s: SheetSnap) => (s === "full" ? fullY : s === "half" ? halfY : closedY);

  const y = useRef(new Animated.Value(closedY)).current;
  const current = useRef(closedY);
  const startY = useRef(0);
  const scrollY = useRef(0);
  const snapRef = useRef<SheetSnap>(snap);
  const scrollRef = useRef<ScrollViewInstance>(null);
  snapRef.current = snap;

  useImperativeHandle(ref, () => ({ scrollToTop: () => scrollRef.current?.scrollTo({ y: 0, animated: false }) }));

  useEffect(() => {
    const id = y.addListener(({ value }) => (current.current = value));
    return () => y.removeListener(id);
  }, [y]);

  // snap prop이 바뀌면 그 위치로 이동
  useEffect(() => {
    Animated.spring(y, { toValue: posOf(snap), useNativeDriver: true, bounciness: 2, speed: 16 }).start();
    if (snap !== "full") scrollRef.current?.scrollTo({ y: 0, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, halfY, fullY, closedY]);

  const responder = useMemo(() => {
    const isVertical = (dx: number, dy: number) => Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx) * 1.2;
    return PanResponder.create({
      // 반 팝업: 세로로 끌면 항상 시트가 가져감. 전체: 내용이 맨 위이고 아래로 끌 때만.
      onMoveShouldSetPanResponderCapture: (_, g) =>
        isVertical(g.dx, g.dy) && (snapRef.current === "half" || (snapRef.current === "full" && scrollY.current <= 0 && g.dy > 0)),
      // 헤더처럼 스크롤 밖 영역에서 시작한 세로 드래그
      onMoveShouldSetPanResponder: (_, g) => isVertical(g.dx, g.dy),
      onPanResponderGrant: () => {
        y.stopAnimation();
        startY.current = current.current;
      },
      onPanResponderMove: (_, g) => {
        y.setValue(Math.max(fullY, startY.current + g.dy));
      },
      onPanResponderRelease: (_, g) => {
        // 손을 뗀 위치 + 속도로 가장 가까운 지점 선택
        // 한 번 끌 때는 바로 옆 단계로만: 전체 → 반, 반 → 전체/닫힘 (네이버 지도처럼 전체에서 바로 닫히지 않게)
        const projected = current.current + g.vy * 180;
        const candidates: Array<[SheetSnap, number]> =
          snapRef.current === "full"
            ? [
                ["full", fullY],
                ["half", halfY],
              ]
            : [
                ["full", fullY],
                ["half", halfY],
                ["closed", closedY],
              ];
        let target = candidates[0];
        for (const c of candidates) if (Math.abs(c[1] - projected) < Math.abs(target[1] - projected)) target = c;
        Animated.spring(y, { toValue: target[1], useNativeDriver: true, bounciness: 2, speed: 16, velocity: g.vy }).start();
        if (target[0] !== snapRef.current) onSnapChange(target[0]);
      },
      onPanResponderTerminate: () => {
        Animated.spring(y, { toValue: posOf(snapRef.current), useNativeDriver: true }).start();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullY, halfY, closedY, onSnapChange]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  };

  return (
    <Animated.View
      style={[
        styles.sheet,
        { height: H - fullY, backgroundColor: colors.surface, transform: [{ translateY: y }] },
        snap === "full" ? styles.flat : styles.rounded,
      ]}
      {...responder.panHandlers}
    >
      <View style={styles.handleWrap} accessibilityLabel="끌어서 크기 조절">
        <View style={[styles.handle, { backgroundColor: colors.line }]} />
      </View>
      {header}
      <ScrollView
        ref={scrollRef}
        scrollEnabled={snap === "full"}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: insets.bottom + (snap === "half" ? H * 0.5 : 24) }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        overScrollMode="never"
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
});

export default BottomSheet;

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 16,
  },
  rounded: { borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  flat: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  handleWrap: { alignItems: "center", paddingTop: 8, paddingBottom: 6 },
  handle: { width: 40, height: 5, borderRadius: 3 },
});
