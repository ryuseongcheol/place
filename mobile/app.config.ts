import type { ExpoConfig } from "expo/config";

// 네이버 클라우드 플랫폼 > Maps > Application 의 Client ID
// .env 의 NAVER_MAP_CLIENT_ID 또는 EAS 환경변수로 넣는다 (지도 SDK용, 공개돼도 되는 키)
const NAVER_MAP_CLIENT_ID = process.env.NAVER_MAP_CLIENT_ID ?? "";

const LOCATION_MESSAGE = "현재 위치 주변 식당을 추천하기 위해 위치 정보를 사용합니다.";

const config: ExpoConfig = {
  name: "근처맛집",
  slug: "nearby-matjip",
  scheme: "matjip",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.ryuseongcheol.matjip",
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: LOCATION_MESSAGE,
      // 카카오맵/네이버지도 앱 설치 여부 확인용
      LSApplicationQueriesSchemes: ["kakaomap", "nmap"],
    },
  },
  android: {
    package: "com.ryuseongcheol.matjip",
    adaptiveIcon: {
      backgroundColor: "#D9480F",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-build-properties",
    ["expo-location", { locationWhenInUsePermission: LOCATION_MESSAGE }],
    [
      "@mj-studio/react-native-naver-map",
      {
        client_id: NAVER_MAP_CLIENT_ID,
        android: { ACCESS_FINE_LOCATION: true, ACCESS_COARSE_LOCATION: true },
        ios: { NSLocationWhenInUseUsageDescription: LOCATION_MESSAGE },
      },
    ],
  ],
};

export default config;
