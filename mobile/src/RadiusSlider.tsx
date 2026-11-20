import { useEffect, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import type { Colors } from "./theme";

/** 검색 반경 범위 (서버 /api/recommend, /api/db/search 가 받는 범위와 같게) */
export const RADIUS_MIN = 200;
export const RADIUS_MAX = 5000;

/**
 * 슬라이더 위치(0~1) ↔ 미터. 가까운 거리를 세밀하게 고르도록 로그 눈금:
 * 왼쪽 끝 200m, 가운데 1km, 오른쪽 끝 5km. 1km 미만은 50m, 이상은 100m 단위.
 */
export function radiusFromPos(t: number) {
  const m = RADIUS_MIN * Math.pow(RADIUS_MAX / RADIUS_MIN, Math.max(0, Math.min(1, t)));
  const step = m < 1000 ? 50 : 100;
  return Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, Math.round(m / step) * step));
}
export function posFromRadius(r: number) {
  return Math.log(Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, r)) / RADIUS_MIN) / Math.log(RADIUS_MAX / RADIUS_MIN);
}
export function formatRadius(r: number) {
  return r < 1000 ? `${r}m` : `${(r / 1000).toFixed(r % 1000 === 0 ? 0 : 1)}km`;
}

const THUMB = 26;

/**
 * 검색 반경 슬라이더. 끌거나 원하는 자리를 누르면 된다.
 * 끄는 동안은 숫자만 바뀌고, 손을 떼면 onChange (검색이 끄는 내내 다시 돌지 않게).
 */
export default function RadiusSlider({
  value,
  onChange,
  colors: c,
  showValue = true,
  compact = false,
}: {
  value: number;
  onChange: (r: number) => void;
  colors: Colors;
  /** 왼쪽에 현재 값 표시 */
  showValue?: boolean;
  /** 아래 눈금 글자(200m·1km·5km) 숨기기 */
  compact?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;

  // PanResponder 는 한 번만 만들어서 최신 값은 ref 로 읽는다
  const st = useRef({ width: 0, startX: 0, value, onChange });
  st.current.width = width;
  st.current.value = value;
  st.current.onChange = onChange;
  useEffect(() => setDrag(null), [value]);

  const at = (x: number) => radiusFromPos((x - THUMB / 2) / Math.max(1, st.current.width - THUMB));

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        st.current.startX = e.nativeEvent.locationX;
        setDrag(at(st.current.startX));
      },
      onPanResponderMove: (_, g) => setDrag(at(st.current.startX + g.dx)),
      onPanResponderRelease: (_, g) => {
        const r = at(st.current.startX + g.dx);
        setDrag(r);
        if (r !== st.current.value) st.current.onChange(r);
        else setDrag(null);
      },
      onPanResponderTerminate: () => setDrag(null),
    }),
  ).current;

  const x = posFromRadius(shown) * Math.max(0, width - THUMB);
  const step = (dir: 1 | -1) => {
    const t = posFromRadius(value);
    let r = value;
    // 눈금 단위로 한 칸씩 (값이 실제로 바뀔 때까지)
    for (let k = 1; k < 60 && r === value; k++) r = radiusFromPos(t + (dir * k) / 100);
    if (r !== value) onChange(r);
  };

  return (
    <View style={styles.row}>
      {showValue && <Text style={[styles.value, { color: c.text }]}>{formatRadius(shown)}</Text>}
      <View style={{ flex: 1 }}>
        <View
          style={styles.touch}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          {...pan.panHandlers}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="검색 반경"
          accessibilityValue={{ text: formatRadius(value) }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? 1 : -1)}
        >
          <View pointerEvents="none" style={[styles.track, { backgroundColor: c.line, left: THUMB / 2, right: THUMB / 2 }]} />
          <View pointerEvents="none" style={[styles.track, { backgroundColor: c.accent, left: THUMB / 2, width: x }]} />
          <View pointerEvents="none" style={[styles.thumb, { left: x, borderColor: c.accent, backgroundColor: c.surface }]} />
        </View>
        {!compact && (
          <View style={styles.ticks} pointerEvents="none">
            <Text style={[styles.tick, { color: c.muted }]}>200m</Text>
            <Text style={[styles.tick, { color: c.muted }]}>1km</Text>
            <Text style={[styles.tick, { color: c.muted }]}>5km</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  value: { minWidth: 50, fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
  touch: { height: 40, justifyContent: "center" },
  track: { position: "absolute", height: 4, borderRadius: 2, top: 18 },
  thumb: { position: "absolute", top: 7, width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 3, elevation: 3, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  ticks: { flexDirection: "row", justifyContent: "space-between", marginTop: -6, paddingHorizontal: 2 },
  tick: { fontSize: 11 },
});
