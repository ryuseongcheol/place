import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";

// 위치 권한이 없을 때 쓰는 기본 위치 (강남역)
export const FALLBACK = { lat: 37.4979, lng: 127.0276 };

export type LocState =
  | { status: "locating" }
  | { status: "ok"; lat: number; lng: number }
  | { status: "fallback"; lat: number; lng: number; message: string };

export function useLocation() {
  const [loc, setLoc] = useState<LocState>({ status: "locating" });

  const locate = useCallback(async () => {
    setLoc({ status: "locating" });
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setLoc({ status: "fallback", ...FALLBACK, message: "위치 권한이 없어 강남역 기준으로 보여드려요. 설정에서 위치 권한을 켜주세요." });
        return;
      }
      // 마지막으로 알려진 위치를 먼저 쓰고, 정확한 위치로 갱신
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
      if (last) setLoc({ status: "ok", lat: last.coords.latitude, lng: last.coords.longitude });
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLoc({ status: "ok", lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      setLoc((prev) =>
        prev.status === "ok" ? prev : { status: "fallback", ...FALLBACK, message: "위치를 가져오지 못해 강남역 기준으로 보여드려요." },
      );
    }
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  return { loc, locate };
}
