import Constants, { ExecutionEnvironment } from "expo-constants";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { GROUP_COLORS } from "./favorites";
import { categoryIcon } from "./shared";
import type { Colors } from "./theme";
import type { ScoredPlace } from "./types";

/* eslint-disable @typescript-eslint/no-require-imports */
// 네이버 지도는 네이티브 모듈이라 Expo Go에는 없다. Expo Go에서 import 자체가 실패하지 않도록 지연 로드.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const NaverMap: typeof import("@mj-studio/react-native-naver-map") | null = (() => {
  if (isExpoGo) return null;
  try {
    return require("@mj-studio/react-native-naver-map");
  } catch {
    return null;
  }
})();

export interface PlacesMapRef {
  focus: (lat: number, lng: number, zoom?: number) => void;
  fitAll: () => void;
}

interface Props {
  me: { lat: number; lng: number } | null;
  places: ScoredPlace[];
  selectedId: string | null;
  /** 즐겨찾기 리스트 색 (없으면 기본 검정) */
  markerColor: (p: ScoredPlace) => string | null;
  onSelect: (place: ScoredPlace) => void;
  onTapMap?: () => void;
  /** 아래 시트/위 버튼에 가려지는 영역 (지도 중심 계산용) */
  padding: { top: number; bottom: number };
  /** 번호 대신 ★로 표시 (즐겨찾기 목록일 때) */
  starMarkers?: boolean;
  /** 아이콘 글꼴을 불러왔는지 (불러온 뒤 마커를 다시 그린다) */
  iconsReady?: boolean;
  colors: Colors;
}

const PlacesMap = forwardRef<PlacesMapRef, Props>(function PlacesMap(
  { me, places, selectedId, markerColor, onSelect, onTapMap, padding, starMarkers, iconsReady, colors },
  ref,
) {
  const mapRef = useRef<import("@mj-studio/react-native-naver-map").NaverMapViewRef>(null);

  const fitAll = () => {
    if (!mapRef.current || places.length === 0) return;
    const pts = [...places.map((p) => ({ lat: p.lat, lng: p.lng })), ...(me ? [me] : [])];
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const padLat = Math.max((maxLat - minLat) * 0.15, 0.002);
    const padLng = Math.max((maxLng - minLng) * 0.15, 0.002);
    mapRef.current.animateRegionTo({
      latitude: minLat - padLat,
      longitude: minLng - padLng,
      latitudeDelta: maxLat - minLat + padLat * 2,
      longitudeDelta: maxLng - minLng + padLng * 2,
      duration: 450,
    });
  };

  useImperativeHandle(ref, () => ({
    focus: (lat, lng, zoom = 16) => mapRef.current?.animateCameraTo({ latitude: lat, longitude: lng, zoom, duration: 350 }),
    fitAll,
  }));

  // 결과 목록이 바뀌면 전체가 보이게
  const placesKey = places.map((p) => p.id).join(",");
  useEffect(() => {
    const t = setTimeout(fitAll, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesKey]);

  if (!NaverMap) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: colors.surface2 }]}>
        <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 19 }}>
          {isExpoGo
            ? "네이버 지도는 Expo Go에서 보이지 않아요.\n개발 빌드나 설치용 APK에서 확인하세요."
            : "지도를 불러오지 못했어요."}
        </Text>
      </View>
    );
  }

  const { NaverMapView, NaverMapMarkerOverlay } = NaverMap;
  const start = me ?? { lat: 37.4979, lng: 127.0276 };
  return (
    <NaverMapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialCamera={{ latitude: start.lat, longitude: start.lng, zoom: 15 }}
      mapPadding={{ top: padding.top, bottom: padding.bottom, left: 0, right: 0 }}
      isShowLocationButton={false}
      isShowZoomControls={false}
      isShowScaleBar={false}
      isExtentBoundedInKorea
      isNightModeEnabled={colors.bg === "#16130F"}
      locale="ko"
      logoAlign="BottomLeft"
      locationOverlay={me ? { isVisible: true, position: { latitude: me.lat, longitude: me.lng } } : { isVisible: false }}
      onTapMap={onTapMap}
    >
      {places.map((p, i) => {
        const active = p.id === selectedId;
        const group = markerColor(p);
        const ring = active ? "#D9480F" : group ? (GROUP_COLORS.find((g) => g.symbol === group)?.hex ?? "#E5484D") : "#FFFFFF";
        const { glyph, color } = categoryIcon(p.category, p.name);
        const size = active ? 44 : 34; // 원 지름
        const W = size + 12;
        const H = size + 16;
        return (
          <NaverMapMarkerOverlay
            key={`${p.id}-${active ? "a" : "n"}-${ring}-${i}-${iconsReady ? 1 : 0}`}
            latitude={p.lat}
            longitude={p.lng}
            width={W}
            height={H}
            anchor={{ x: 0.5, y: 1 }}
            zIndex={active ? 100 : places.length - i}
            caption={{ text: p.name, textSize: active ? 13 : 11, haloColor: "#ffffff", requestedWidth: 120 }}
            isHideCollidedCaptions
            onTap={() => onSelect(p)}
          >
            {/* 업종 아이콘 핀 (네이티브에서 비트맵으로 그려진다) */}
            <View collapsable={false} style={{ width: W, height: H, alignItems: "center", paddingTop: 4 }}>
              <View
                style={{
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: color,
                  borderWidth: active ? 4 : 3,
                  borderColor: ring,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* 평면 픽토그램 (흰색) */}
                <MaterialCommunityIcons name={glyph as keyof typeof MaterialCommunityIcons.glyphMap} size={Math.round(size * 0.52)} color="#FFFFFF" />
              </View>
              <View style={[styles.tail, { borderTopColor: ring === "#FFFFFF" ? color : ring }]} />
              <View style={[styles.badge, { backgroundColor: starMarkers ? (group ? ring : "#F5A400") : active ? "#D9480F" : "#1F1A14" }]}>
                <Text style={styles.badgeText}>{starMarkers ? "★" : i + 1}</Text>
              </View>
            </View>
          </NaverMapMarkerOverlay>
        );
      })}
    </NaverMapView>
  );
});

export default PlacesMap;

const styles = StyleSheet.create({
  tail: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 9,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  placeholder: { alignItems: "center", justifyContent: "center", padding: 24 },
});
