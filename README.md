# 근처맛집

현재 위치 주변 식당을 **카카오맵·네이버지도의 별점/리뷰**로 평가해서, 고른 **테마**(혼밥·데이트·해장 등)나 **자유 입력**("비 오는 날 혼자 조용히 먹을 국물")에 맞게 추천하는 웹앱(PWA)입니다.

- **`mobile/`** — iOS·Android 네이티브 앱 (Expo + 네이버 지도). 사용법은 [mobile/README.md](mobile/README.md)
- **루트** — 추천 API 서버 (Next.js 15). 키가 필요한 수집·AI 호출은 모두 여기서 하고, 앱은 이 API만 호출합니다. 간단한 웹 화면도 함께 제공합니다.

## 동작 방식

```
위치 + 테마/자유입력
   │
   ├─ ① 주제 해석: 프리셋 → 검색어 / 자유 입력 → Claude가 검색어·가중치로 변환
   ├─ ② 후보 수집 [공식] 카카오 로컬 키워드 검색 (반경, 음식점 FD6 / 카페 CE7)
   ├─ ③ 리뷰 수집 [비공식] 카카오맵 별점·후기, 네이버지도 방문자/블로그 리뷰 수
   │                [공식]  네이버 검색 API (비공식 실패 시 장소 매칭·링크용)
   ├─ ④ 점수: 별점(베이지안 보정) · 리뷰 수(로그) · 주제 관련도 · 거리
   └─ ⑤ Claude가 상위 15곳의 리뷰를 읽고 재정렬 + 추천 이유 작성
```

키가 없는 단계는 자동으로 건너뜁니다. 카카오 키가 없으면 **예시 데이터(mock)** 로 돌아가서 UI 작업이 가능합니다.

## 시작하기

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

http://localhost:3000 접속. 휴대폰에서 위치를 쓰려면 HTTPS가 필요합니다 (Vercel 배포 또는 `next dev --experimental-https`).

## 필요한 키

| 환경변수 | 필수 | 발급처 | 용도 |
|---|---|---|---|
| `KAKAO_REST_API_KEY` | ✅ | [카카오 디벨로퍼스](https://developers.kakao.com) > 내 애플리케이션 > 앱 키 | 주변 식당 검색, 행정동 조회 |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | 지도 표시 시 | 같은 앱의 **JavaScript 키** + 플랫폼 > Web에 도메인 등록 | 결과 지도 |
| `NAVER_HUB_CLIENT_ID` / `NAVER_HUB_CLIENT_SECRET` | 선택 | 네이버 클라우드 콘솔 > Services > Application Services > **NAVER API HUB** > Application 등록 (검색 API) | 블로그 리뷰, 대체 사진, 네이버 장소 매칭 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 선택 | 네이버 개발자센터 검색 API (**2026-07-31 신규 발급 종료**, 기존 키만) | 위와 같음. HUB 키가 있으면 HUB를 우선 사용 |
| `ANTHROPIC_API_KEY` | 선택 | [Claude Console](https://console.anthropic.com) | 자유 입력 해석, 리뷰 기반 재정렬·추천 이유 |
| `CLAUDE_MODEL` | 선택 | | 기본 `claude-opus-5-5`. 비용을 줄이려면 `claude-haiku-5-5` 등 |
| `UNOFFICIAL_REVIEWS` | | | `0`이면 비공식 리뷰 수집 끔 |
| `SUBREQUEST_BUDGET` | | | 요청 한 번에 쓸 외부 호출 수. 기본 48 (Cloudflare 무료 플랜 한도 50). 유료 플랜이면 `500` 등으로 올리면 검색 페이지·리뷰 조회 수가 늘어남 |
| `RESULT_COUNT` | | | 추천 결과 수. 기본 20 (5~30) |
| `MOCK_MODE` | | | `1`이면 예시 데이터 사용 |

## 지도 UI

- 앱: 네이버 지도 SDK (`mobile/src/PlacesMap.tsx`)
- 웹 화면: 카카오맵 JavaScript SDK를 씁니다. 검색 결과(카카오 place id, 좌표)와 같은 출처라 핀 위치가 정확히 맞고, 일 30만 회까지 무료입니다. `NEXT_PUBLIC_KAKAO_JS_KEY`가 없거나 SDK 로드에 실패하면 지도 없이 목록만 보여줍니다 (`app/KakaoMap.tsx`).

## ⚠️ 비공식 리뷰 수집에 대해

카카오·네이버 모두 **별점/리뷰를 공식 API로 제공하지 않습니다.** `lib/kakao.ts`의 `fetchKakaoReviews`, `lib/naver.ts`의 `naverMapSearch`는 각 지도 웹사이트가 내부적으로 쓰는 엔드포인트를 호출합니다.

- 이용약관 위반 소지가 있고, 응답 구조 변경이나 차단으로 **언제든 동작이 멈출 수 있습니다**. 파서는 키 이름으로 느슨하게 탐색하도록 만들었지만, 막히면 해당 소스만 `실패`로 표시되고 나머지로 추천합니다.
- 서버 부하를 줄이려고 캐시(별점 6시간, 검색 10~30분), 동시 요청 4개, 검색당 최대 24곳, IP당 분당 12회 제한을 둡니다.
- 개인 프로젝트/프로토타입 용도를 권장합니다. 공개 서비스로 운영한다면 `UNOFFICIAL_REVIEWS=0`으로 끄고 Google Places API 같은 공식 별점 API로 교체하는 것을 고려하세요.
- 네이버는 2021년부터 지도 별점을 대부분 없애고 키워드 리뷰로 바꿔서, 네이버 쪽은 주로 **방문자/블로그 리뷰 수**와 키워드를 씁니다.

## 구조

```
mobile/                 네이티브 앱 (Expo)
app/
  page.tsx              메인 화면 (위치, 테마, 결과 카드)
  KakaoMap.tsx          카카오맵 SDK 지도
  api/recommend/route.ts  추천 API (POST)
  api/place/[id]/route.ts 식당 상세 API (GET: 사진·메뉴·후기·블로그 리뷰)
  api/regions/route.ts    동 이름 검색 / 현재 위치의 동
  api/crawl/list/route.ts 지역 식당 목록 수집 (커서로 이어받기)
  api/crawl/detail/route.ts 식당 상세 + 숨은 분류값 (앱이 직접 못 받을 때)
  api/themes/route.ts     테마 목록 + 설정 상태
lib/
  recommend.ts          전체 파이프라인
  kakao.ts              카카오 검색(공식) + 별점(비공식)
  kakaoDetail.ts        카카오 상세에서 사진·메뉴·후기·블로그 추출
  placeDetail.ts        식당 상세 조립
  naver.ts              네이버 검색(공식/비공식) + 장소 매칭
  score.ts              점수 계산
  ai.ts                 Claude: 주제 해석, 재정렬
  themes.ts             주제 (상황·기분, 숨은 분류값 가중치) — 앱과 공유
  classify.ts           숨은 분류값 26가지 계산 — 앱과 공유
  crawl.ts              지역 격자 수집
  mock.ts               예시 데이터
```
