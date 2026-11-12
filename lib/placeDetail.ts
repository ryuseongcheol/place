import { fetchKakaoRaw, regionName } from "./kakao";
import {
  extractHomepage,
  extractKakaoBlogReviews,
  extractKakaoReviews,
  extractMenus,
  extractOpenHours,
  extractPhotos,
} from "./kakaoDetail";
import { mockDetail } from "./mock";
import { naverBlogSearch, naverImageSearch, naverPlaceLinks, naverSearchEnabled } from "./naver";
import { isMockMode } from "./recommend";
import type { PlaceDetail } from "./types";

export interface DetailRequest {
  id: string;
  name: string;
  lat: number;
  lng: number;
  naverId: string | null;
}

export async function getPlaceDetail(req: DetailRequest): Promise<PlaceDetail> {
  if (isMockMode()) return mockDetail(req.id, req.name);

  const useUnofficial = process.env.UNOFFICIAL_REVIEWS !== "0";
  const isKakaoId = /^\d+$/.test(req.id);
  const region = await regionName({ lat: req.lat, lng: req.lng });

  const [raw, blog] = await Promise.all([
    useUnofficial && isKakaoId ? fetchKakaoRaw(req.id) : Promise.resolve(null),
    naverBlogSearch(req.name, region),
  ]);

  let photos = raw ? extractPhotos(raw) : [];
  let photoSource: PlaceDetail["photoSource"] = photos.length ? "kakao" : null;
  let naverImage: PlaceDetail["sources"]["naverImage"] = naverSearchEnabled() ? "ok" : "disabled";
  if (!photos.length) {
    const imgs = await naverImageSearch(req.name, region);
    if (imgs?.length) {
      photos = imgs;
      photoSource = "naver";
    } else if (naverSearchEnabled()) naverImage = imgs ? "partial" : "failed";
  }

  // 블로그 리뷰: 카카오 상세에 있는 것 + 네이버 블로그 검색 (URL 중복 제거)
  const kakaoBlogs = raw ? extractKakaoBlogReviews(raw) : [];
  const seen = new Set(kakaoBlogs.map((b) => b.url));
  const blogReviews = [...kakaoBlogs, ...(blog?.items ?? []).filter((b) => !seen.has(b.url))];

  const naver = naverPlaceLinks(req.naverId, req.name, region);
  return {
    id: req.id,
    photos,
    photoSource,
    menus: raw ? extractMenus(raw) : [],
    openHours: raw ? extractOpenHours(raw) : [],
    homepage: raw ? extractHomepage(raw) : null,
    kakaoReviews: raw ? extractKakaoReviews(raw) : [],
    blogReviews,
    blogReviewTotal: blog?.total ?? null,
    links: {
      kakaoPlace: isKakaoId ? `https://place.map.kakao.com/${req.id}` : `https://m.map.kakao.com/actions/searchView?q=${encodeURIComponent(req.name)}`,
      kakaoReviews: isKakaoId ? `https://place.map.kakao.com/${req.id}#comment` : `https://m.map.kakao.com/actions/searchView?q=${encodeURIComponent(req.name)}`,
      naverPlace: naver.place,
      naverVisitorReviews: naver.visitor,
      naverBlogReviews: naver.blog,
    },
    sources: {
      kakaoDetail: !useUnofficial ? "disabled" : raw ? "ok" : "failed",
      naverBlog: !naverSearchEnabled() ? "disabled" : blog ? "ok" : "failed",
      naverImage,
    },
  };
}
