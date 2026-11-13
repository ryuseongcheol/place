import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import {
  getListenerStatus,
  isNotificationAccessEnabled,
  paymentNotificationsSupported,
  requestRebind,
  type PaymentListenerStatus,
} from "../modules/payment-notifications";

/** 결제 알림 읽기 권한 상태. 설정 화면에서 돌아오면 다시 확인한다 */
export function usePaymentAccess() {
  const [enabled, setEnabled] = useState(() => isNotificationAccessEnabled());
  const [status, setStatus] = useState<PaymentListenerStatus | null>(() => getListenerStatus());
  const refresh = useCallback(() => {
    const on = isNotificationAccessEnabled();
    const st = getListenerStatus();
    setEnabled(on);
    setStatus(st);
    // 허용돼 있는데 리스너가 붙어 있지 않으면 다시 붙여 달라고
    if (on && st?.connected === false) requestRebind();
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => sub.remove();
  }, [refresh]);
  return { supported: paymentNotificationsSupported, enabled, status, refresh };
}
