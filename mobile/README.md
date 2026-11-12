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

## 화면 구성 (네이버 지도 방식)

1. 전체 화면이 네이버 지도
2. 앱을 켜면 "어떤 맛집을 찾으세요?" 추천 팝업이 지도 위에 뜸
3. 지도 하단의 **맛집추천** 버튼으로 팝업을 다시 열 수 있음
4. 마커/목록에서 식당을 누르면 아래에서 **반 팝업**으로 상세가 뜨고, 위로 끌면 **전체 화면**, 내리면 다시 반 팝업, 더 내리면 닫힘
5. 상세: 저장(즐겨찾기)·길찾기·전화·카카오맵, 사진, 추천 이유, 정보(주소/영업시간/홈페이지), 메뉴, 리뷰(네이버 방문자 리뷰 → 웹뷰, 카카오맵 후기), 블로그 리뷰(누르면 웹뷰)
6. 상단 ★ 버튼: 즐겨찾기 목록 (기기에 저장, 앱을 다시 켜도 유지)

## 리뷰 데이터 출처

| 항목 | 출처 |
|---|---|
| 사진·메뉴·카카오맵 후기 | 카카오맵 장소 상세 (비공식) |
| 블로그 리뷰 | 네이버 블로그 검색 API (공식, `NAVER_CLIENT_ID/SECRET` 필요) + 카카오맵 블로그 리뷰 |
| 네이버 방문자 리뷰 | 공식 API가 없어 리뷰 수·키워드만 표시, 본문은 네이버 플레이스 페이지를 웹뷰로 |
| 사진 (카카오에 없을 때) | 네이버 이미지 검색 API (공식) |

## 구조

```
App.tsx                  지도 화면: 상단 바, 맛집추천 버튼, 시트·팝업 상태 관리
src/PlacesMap.tsx        전체 화면 네이버 지도 + 마커
src/SearchPanel.tsx      추천 조건 팝업
src/BottomSheet.tsx      반/전체/닫힘 바텀시트 (RN Animated + PanResponder)
src/PlaceList.tsx        추천 결과·즐겨찾기 목록
src/PlaceDetailView.tsx  식당 상세 (사진, 메뉴, 리뷰, 블로그)
src/WebViewModal.tsx     리뷰·블로그 웹뷰 브라우저
src/favorites.tsx        즐겨찾기 (AsyncStorage)
src/api.ts               서버 API 호출
src/useLocation.ts       위치 권한/현재 위치
src/openMap.ts           카카오맵·네이버지도 앱으로 열기
src/types.ts             서버 응답 타입 (../lib/types.ts 복사본)
app.config.ts            앱 이름, 권한, 네이버 지도 키 설정
```
