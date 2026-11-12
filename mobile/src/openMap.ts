import { Linking } from "react-native";
import type { ScoredPlace } from "./types";

const APP_NAME = "com.ryuseongcheol.matjip";

/** 앱이 설치돼 있으면 앱으로, 없으면 웹으로 연다 */
async function openWithFallback(appUrl: string, webUrl: string) {
  try {
    if (await Linking.canOpenURL(appUrl)) {
      await Linking.openURL(appUrl);
      return;
    }
  } catch {
    // 웹으로
  }
  await Linking.openURL(webUrl);
}

export function openKakaoMap(p: ScoredPlace) {
  const isRealId = /^\d+$/.test(p.id);
  const app = isRealId ? `kakaomap://place?id=${p.id}` : `kakaomap://look?p=${p.lat},${p.lng}`;
  return openWithFallback(app, p.kakaoUrl);
}

export function openNaverMap(p: ScoredPlace) {
  const app = `nmap://place?lat=${p.lat}&lng=${p.lng}&name=${encodeURIComponent(p.name)}&appname=${APP_NAME}`;
  const web = p.naver?.naverUrl ?? `https://map.naver.com/p/search/${encodeURIComponent(p.name)}`;
  return openWithFallback(app, web);
}

export function callPhone(phone: string) {
  return Linking.openURL(`tel:${phone.replace(/[^0-9+]/g, "")}`);
}
