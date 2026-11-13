import type { ExpoConfig } from "expo/config";

// 네이버 클라우드 플랫폼 > Maps > Application 의 Client ID (지도 SDK용, 앱에 포함되는 공개 키)
// .env 의 NAVER_MAP_CLIENT_ID 가 있으면 그 값을 우선 사용
const NAVER_MAP_CLIENT_ID = process.env.NAVER_MAP_CLIENT_ID || "3ukni6vwbn";

/**
 * 버전 관리
 * - APP_VERSION: 사람이 보는 버전. 기능 추가는 두 번째 자리(1.1.0 → 1.2.0), 수정은 세 번째 자리(1.2.0 → 1.2.1)
 * - versionCode(빌드 번호): GitHub Actions 실행 번호로 자동 증가. 안드로이드는 이 숫자가 커야 업데이트로 설치된다
 */
export const APP_VERSION = "1.4.0";
const BUILD_NUMBER = Number(process.env.APP_BUILD_NUMBER) || 1;
const COMMIT = process.env.APP_COMMIT ?? "local";

const LOCATION_MESSAGE = "현재 위치 주변 식당을 추천하기 위해 위치 정보를 사용합니다.";

const config: ExpoConfig = {
  name: "근처맛집",
  slug: "nearby-matjip",
  scheme: "matjip",
  version: APP_VERSION,
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.ryuseongcheol.matjip",
    buildNumber: String(BUILD_NUMBER),
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: LOCATION_MESSAGE,
      // 카카오맵/네이버지도 앱 설치 여부 확인용
      LSApplicationQueriesSchemes: ["kakaomap", "nmap"],
    },
  },
  android: {
    package: "com.ryuseongcheol.matjip",
    versionCode: BUILD_NUMBER,
    adaptiveIcon: {
      backgroundColor: "#D9480F",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "CAMERA"],
    predictiveBackGestureEnabled: false,
  },
  extra: {
    buildNumber: BUILD_NUMBER,
    commit: COMMIT,
    builtAt: new Date().toISOString(),
    releasesRepo: "ryuseongcheol/place",
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
      "expo-image-picker",
      {
        photosPermission: "내 평가에 사진을 붙이기 위해 사진 보관함에 접근합니다.",
        cameraPermission: "내 평가에 붙일 사진을 찍기 위해 카메라를 사용합니다.",
        microphonePermission: false,
      },
    ],
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
