import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// 배포된 서버가 어느 커밋인지 /api/themes 에서 확인할 수 있게 빌드 시점의 커밋을 넣는다.
// Cloudflare Workers Builds는 WORKERS_CI_COMMIT_SHA 를 제공한다.
function buildSha() {
  const isSha = (v: string | undefined): v is string => !!v && /^[0-9a-f]{7,40}$/i.test(v);
  try {
    const git = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (isSha(git)) return git;
  } catch {
    // git 없음
  }
  // 환경변수 중 커밋 해시처럼 생긴 값만 사용 (브랜치 이름이 들어 있는 경우가 있음)
  const fromEnv = [process.env.WORKERS_CI_COMMIT_SHA, process.env.GITHUB_SHA, process.env.CF_PAGES_COMMIT_SHA].find(isSha);
  return fromEnv ? fromEnv.slice(0, 7) : "unknown";
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    BUILD_SHA: buildSha(),
    BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
