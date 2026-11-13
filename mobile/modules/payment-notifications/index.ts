import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

/** 결제 알림 하나 (네이티브가 알림을 받은 순간 저장한 원본) */
export interface RawPaymentNotification {
  key: string;
  package: string;
  title: string;
  text: string;
  sub?: string;
  postedAt: number;
  lat?: number;
  lng?: number;
  locAt?: number;
  accuracy?: number;
}

export interface PaymentListenerStatus {
  connectedAt?: number | null;
  disconnectedAt?: number | null;
  lastCapturedAt?: number | null;
  capturedCount: number;
  pendingCount: number;
}

interface NativeModule {
  isEnabled(): boolean;
  openSettings(): void;
  openAppDetails(): void;
  requestRebind(): void;
  getPending(): string;
  ack(maxPostedAt: number): void;
  getStatus(): PaymentListenerStatus;
}

// 안드로이드 앱에만 있다 (웹·iOS·예전 APK 에서는 null)
const native = Platform.OS === "android" ? requireOptionalNativeModule<NativeModule>("PaymentNotifications") : null;

export const paymentNotificationsSupported = !!native;

export function isNotificationAccessEnabled(): boolean {
  try {
    return native?.isEnabled() ?? false;
  } catch {
    return false;
  }
}

export function openNotificationAccessSettings() {
  native?.openSettings();
}

export function openAppDetails() {
  native?.openAppDetails();
}

export function requestRebind() {
  try {
    native?.requestRebind();
  } catch {}
}

export function getPendingPayments(): RawPaymentNotification[] {
  if (!native) return [];
  try {
    const arr = JSON.parse(native.getPending());
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function ackPayments(maxPostedAt: number) {
  try {
    native?.ack(maxPostedAt);
  } catch {}
}

export function getListenerStatus(): PaymentListenerStatus | null {
  try {
    return native?.getStatus() ?? null;
  } catch {
    return null;
  }
}
