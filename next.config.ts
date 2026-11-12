import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// 배포된 서버가 어느 커밋인지 /api/themes 에서 확인할 수 있게 빌드 시점의 커밋을 넣는다.
// Cloudflare Workers Builds는 WORKERS_CI_COMMIT_SHA 를 제공한다.
function buildSha() {
  const fromCi = process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    BUILD_SHA: buildSha(),
    BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
