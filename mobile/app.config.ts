import type { ExpoConfig } from "expo/config";

// 네이버 클라우드 플랫폼 > Maps > Application 의 Client ID (지도 SDK용, 앱에 포함되는 공개 키)
// .env 의 NAVER_MAP_CLIENT_ID 가 있으면 그 값을 우선 사용
const NAVER_MAP_CLIENT_ID = process.env.NAVER_MAP_CLIENT_ID || "3ukni6vwbn";

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
    "expo-background-task",
    [
      "expo-build-properties",
      {
        android: {
          // 네이버 지도 Android SDK는 Maven Central이 아니라 네이버 저장소에 있다
          extraMavenRepos: ["https://repository.map.naver.com/archive/maven"],
          // 백그라운드 수집(WorkManager)의 Room DB 클래스를 출시 빌드 최적화(R8)가 지워 시작하자마자 죽던 문제
          extraProguardRules: [
            "-keep class androidx.work.** { *; }",
            "-keep class * extends androidx.room.RoomDatabase { <init>(); }",
            "-keep class androidx.room.** { *; }",
          ].join("\n"),
        },
      },
    ],
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
