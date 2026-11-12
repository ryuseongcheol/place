# 근처맛집 모바일 앱 (Expo)

저장소 루트의 Next.js 서버(`/api/recommend`)를 호출하는 iOS·Android 앱입니다.
카카오·네이버 수집과 Claude 호출은 API 키가 앱에 들어가면 안 되므로 **서버에서만** 합니다.

- Expo SDK 58 / React Native 0.88
- 지도: 네이버 지도 SDK ([@mj-studio/react-native-naver-map](https://github.com/mym0404/react-native-naver-map))
- 위치: expo-location

## 준비

1. **네이버 지도 키**: [네이버 클라우드 플랫폼](https://console.ncloud.com) > Services > Maps > Application 등록
   - Dynamic Map 선택, Android 패키지명 `com.ryuseongcheol.matjip`, iOS Bundle ID `com.ryuseongcheol.matjip` 입력
   - 발급된 **Client ID**는 `app.config.ts`에 기본값으로 들어 있음. 다른 키를 쓰려면 `.env`의 `NAVER_MAP_CLIENT_ID`에
2. **서버**: 저장소 루트에서 `npm run dev` (기본 :3000)

```bash
cp .env.example .env
```

```bash
npm install
```

## 실행

네이버 지도는 네이티브 모듈이라 **Expo Go에서는 지도가 안 보입니다** (목록은 동작). 개발 빌드로 실행하세요.

로컬에 Android Studio / Xcode가 있으면:

```bash
npm run android
```

```bash
npm run ios
```

없으면 EAS 클라우드 빌드 후 설치:

```bash
npx eas-cli@latest build --profile development --platform android
```

빌드한 앱을 켠 뒤 개발 서버 연결:

```bash
npm start
```

## 서버 주소

- `EXPO_PUBLIC_API_URL`을 비워두면 개발 중에는 **Expo 개발 서버를 띄운 PC의 IP:3000**으로 요청합니다. 폰과 PC가 같은 와이파이면 실기기에서도 동작합니다.
- 배포용 빌드에서는 서버를 배포(Vercel 등)하고 `EXPO_PUBLIC_API_URL=https://...`을 넣으세요. 릴리스 빌드는 HTTP를 막으므로 HTTPS 주소여야 합니다.

## 구조

```
App.tsx            메인 화면 (위치, 테마, 지도, 결과 카드)
src/api.ts         서버 API 호출
src/PlacesMap.tsx  네이버 지도 + 번호 마커
src/useLocation.ts 위치 권한/현재 위치
src/openMap.ts     카카오맵·네이버지도 앱으로 열기 (없으면 웹)
src/types.ts       서버 응답 타입 (../lib/types.ts 복사본)
app.config.ts      앱 이름, 권한, 네이버 지도 키 설정
```
