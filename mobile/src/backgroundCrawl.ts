import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { runCrawls } from "./crawlEngine";
import { syncPayments } from "./payments";

/**
 * 앱이 꺼져 있어도 지역 맛집 수집을 이어서 하는 백그라운드 작업. 결제 알림으로 받은 방문 기록 정리도 같이 한다.
 * 안드로이드(WorkManager)가 15분 이상 간격으로 깨워 주면 몇 분 동안 수집하고 멈춘다.
 * 진행 상황은 파일에 저장되므로 다음 실행이나 앱을 켤 때 이어서 한다.
 * 이 파일은 앱 시작 시(index.ts) 가장 먼저 불러와야 한다 (작업 정의는 전역에서 해야 함).
 */
export const CRAWL_TASK = "region-crawl";
const RUN_LIMIT_MS = 4 * 60 * 1000; // 한 번 깨어날 때 최대 4분

if (Platform.OS !== "web") {
  TaskManager.defineTask(CRAWL_TASK, async () => {
    try {
      // 결제 알림 → 방문 기록 (가게 맞추기까지)
      await syncPayments({ force: true, scan: true }).catch(() => {});
      await runCrawls({ deadline: Date.now() + RUN_LIMIT_MS });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** 앱 실행 시 한 번 호출: 백그라운드 수집 등록 */
export async function registerBackgroundCrawl() {
  if (Platform.OS === "web") return;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (!(await TaskManager.isTaskRegisteredAsync(CRAWL_TASK))) {
      await BackgroundTask.registerTaskAsync(CRAWL_TASK, { minimumInterval: 15 });
    }
  } catch {
    // 등록 실패해도 앱이 켜져 있을 때 수집은 계속된다
  }
}
