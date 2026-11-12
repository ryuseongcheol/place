import Constants from "expo-constants";

/** 앱 버전 정보 (app.config.ts 의 APP_VERSION + 빌드 번호 + 커밋) */
const extra = (Constants.expoConfig?.extra ?? {}) as { buildNumber?: number; commit?: string; releasesRepo?: string };
export const APP_VERSION = Constants.expoConfig?.version ?? "?";
export const BUILD_NUMBER = Number(extra.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? 0);
export const COMMIT = extra.commit ?? "";
const REPO = extra.releasesRepo ?? "ryuseongcheol/place";

export interface LatestRelease {
  version: string;
  build: number;
  apkUrl: string;
  pageUrl: string;
  newer: boolean;
}

/** GitHub의 최신 버전 Release (android-v<버전>-<빌드>) 확인 */
export async function checkLatestRelease(): Promise<LatestRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const r = (await res.json()) as { tag_name: string; html_url: string; assets: Array<{ name: string; browser_download_url: string }> };
    const m = r.tag_name.match(/^android-v(.+)-(\d+)$/);
    if (!m) return null;
    const apk = r.assets.find((a) => a.name.endsWith(".apk"));
    const build = Number(m[2]);
    return { version: m[1], build, apkUrl: apk?.browser_download_url ?? r.html_url, pageUrl: r.html_url, newer: build > BUILD_NUMBER };
  } catch {
    return null;
  }
}
