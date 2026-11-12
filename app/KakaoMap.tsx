"use client";

import { useEffect, useRef, useState } from "react";
import type { ScoredPlace } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    kakao?: any;
  }
}

const JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
let sdkPromise: Promise<any> | null = null;

/** 카카오맵 JavaScript SDK를 한 번만 불러온다 */
function loadKakaoSdk(): Promise<any> {
  if (!JS_KEY) return Promise.reject(new Error("NEXT_PUBLIC_KAKAO_JS_KEY 없음"));
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.kakao?.maps) return window.kakao.maps.load(() => resolve(window.kakao));
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${JS_KEY}&autoload=false`;
    s.async = true;
    s.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("카카오맵 SDK 로드 실패"));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export function mapAvailable() {
  return Boolean(JS_KEY);
}

interface Props {
  center: { lat: number; lng: number };
  places: ScoredPlace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function KakaoMap({ center, places, selectedId, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const [failed, setFailed] = useState(false);

  // 지도 생성 + 마커 갱신
  useEffect(() => {
    let cancelled = false;
    loadKakaoSdk()
      .then((kakao) => {
        if (cancelled || !el.current) return;
        const { maps } = kakao;
        const me = new maps.LatLng(center.lat, center.lng);
        if (!mapRef.current) {
          mapRef.current = new maps.Map(el.current, { center: me, level: 4 });
          mapRef.current.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT);
        }
        const map = mapRef.current;
        overlaysRef.current.forEach((o) => o.setMap(null));
        overlaysRef.current = [];

        const bounds = new maps.LatLngBounds();
        bounds.extend(me);

        // 내 위치
        const meDot = document.createElement("div");
        meDot.className = "map-me";
        meDot.setAttribute("aria-label", "내 위치");
        overlaysRef.current.push(new maps.CustomOverlay({ position: me, content: meDot, map, zIndex: 1 }));

        // 추천 식당 번호 마커
        places.forEach((p, i) => {
          const pos = new maps.LatLng(p.lat, p.lng);
          bounds.extend(pos);
          const pin = document.createElement("button");
          pin.type = "button";
          pin.className = "map-pin" + (p.id === selectedId ? " active" : "");
          pin.textContent = String(i + 1);
          pin.title = p.name;
          pin.onclick = () => onSelect(p.id);
          overlaysRef.current.push(
            new maps.CustomOverlay({ position: pos, content: pin, map, yAnchor: 1, zIndex: p.id === selectedId ? 3 : 2 }),
          );
        });
        if (places.length) map.setBounds(bounds, 40, 40, 40, 40);
        else map.setCenter(me);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [center.lat, center.lng, places, selectedId, onSelect]);

  // 선택된 식당으로 이동
  useEffect(() => {
    const p = places.find((x) => x.id === selectedId);
    if (p && mapRef.current && window.kakao?.maps) {
      mapRef.current.panTo(new window.kakao.maps.LatLng(p.lat, p.lng));
    }
  }, [selectedId, places]);

  if (failed) return null;
  return <div ref={el} className="map" role="region" aria-label="추천 식당 지도" />;
}
