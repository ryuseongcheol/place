import Constants, { ExecutionEnvironment } from "expo-constants";
import { useEffect, useRef } from "react";
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

interface Props {
  center: { lat: number; lng: number };
  places: ScoredPlace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  colors: Colors;
}

export default function PlacesMap({ center, places, selectedId, onSelect, colors }: Props) {
  const ref = useRef<import("@mj-studio/react-native-naver-map").NaverMapViewRef>(null);

  // 결과가 바뀌면 전체가 보이도록
  useEffect(() => {
    if (!ref.current || places.length === 0) return;
    const lats = [center.lat, ...places.map((p) => p.lat)];
    const lngs = [center.lng, ...places.map((p) => p.lng)];
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    ref.current.animateRegionTo({
      latitude: minLat,
      longitude: minLng,
      latitudeDelta: (maxLat - minLat) * 1.3 || 0.01,
      longitudeDelta: (maxLng - minLng) * 1.3 || 0.01,
      duration: 400,
    });
  }, [places, center.lat, center.lng]);

  // 선택한 식당으로 이동
  useEffect(() => {
    const p = places.find((x) => x.id === selectedId);
    if (p && ref.current) ref.current.animateCameraTo({ latitude: p.lat, longitude: p.lng, zoom: 16, duration: 350 });
  }, [selectedId, places]);

  if (!NaverMap) {
    return (
      <View style={[styles.placeholder, { backgroundColor: colors.surface2, borderColor: colors.line }]}>
        <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 19 }}>
          {isExpoGo
            ? "네이버 지도는 Expo Go에서 보이지 않아요.\n개발 빌드(npx expo run:ios / run:android)에서 확인하세요."
            : "지도를 불러오지 못했어요."}
        </Text>
      </View>
    );
  }

  const { NaverMapView, NaverMapMarkerOverlay } = NaverMap;
  return (
    <View style={[styles.wrap, { borderColor: colors.line }]}>
      <NaverMapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        initialCamera={{ latitude: center.lat, longitude: center.lng, zoom: 15 }}
        isShowLocationButton={false}
        isShowZoomControls={false}
        isExtentBoundedInKorea
        locale="ko"
        locationOverlay={{ isVisible: true, position: { latitude: center.lat, longitude: center.lng } }}
      >
        {places.map((p, i) => {
          const active = p.id === selectedId;
          return (
            <NaverMapMarkerOverlay
              key={p.id}
              latitude={p.lat}
              longitude={p.lng}
              image={{ symbol: active ? "red" : "black" }}
              width={active ? 34 : 26}
              height={active ? 44 : 34}
              zIndex={active ? 10 : 1}
              caption={{ text: `${i + 1}. ${p.name}`, textSize: active ? 13 : 11 }}
              onTap={() => onSelect(p.id)}
            />
          );
        })}
      </NaverMapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 280,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginBottom: 12,
  },
  placeholder: {
    height: 120,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    marginBottom: 12,
  },
});
