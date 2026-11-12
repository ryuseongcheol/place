import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 정적 페이지 캐시(R2 등)는 쓰지 않는다. 추천 API는 매 요청 동적으로 처리.
export default {
  ...defineCloudflareConfig(),
  // package.json 의 "build" 가 OpenNext 빌드를 부르므로, 내부 Next 빌드는 next build 를 직접 호출해 무한 반복을 막는다
  buildCommand: "npx next build",
};
