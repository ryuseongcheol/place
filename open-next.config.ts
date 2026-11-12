import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 정적 페이지 캐시(R2 등)는 쓰지 않는다. 추천 API는 매 요청 동적으로 처리.
export default defineCloudflareConfig();
