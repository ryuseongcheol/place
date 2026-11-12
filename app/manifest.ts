import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "근처맛집 — 리뷰로 고르는 주변 식당",
    short_name: "근처맛집",
    description: "카카오맵·네이버지도 리뷰와 별점으로 내 주변에서 주제에 맞는 식당을 추천해요.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbf7f2",
    theme_color: "#fbf7f2",
    lang: "ko",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
