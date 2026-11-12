import Constants, { ExecutionEnvironment } from "expo-constants";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
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
  colors: Colors;
}

const PlacesMap = forwardRef<PlacesMapRef, Props>(function PlacesMap(
  { me, places, selectedId, markerColor, onSelect, onTapMap, padding, starMarkers, colors },
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
        const color = markerColor(p);
        return (
          <NaverMapMarkerOverlay
            key={p.id}
            latitude={p.lat}
            longitude={p.lng}
            image={{ symbol: (color ?? (active ? "red" : "black")) as "red" }}
            width={active ? 36 : 28}
            height={active ? 46 : 36}
            zIndex={active ? 100 : places.length - i}
            caption={{ text: starMarkers ? `★ ${p.name}` : `${i + 1}. ${p.name}`, textSize: active ? 14 : 12, haloColor: "#ffffff" }}
            isHideCollidedCaptions
            onTap={() => onSelect(p)}
          />
        );
      })}
    </NaverMapView>
  );
});

export default PlacesMap;

const styles = StyleSheet.create({
  placeholder: { alignItems: "center", justifyContent: "center", padding: 24 },
});
