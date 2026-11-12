// 서버와 공유하는 순수 로직 (../../lib). 서버 전용 코드(next, 키가 필요한 API 호출)는 가져오지 않는다.
export { ATTR_LABELS, attrFit, classify, topReasons, type AttrKey, type Attrs } from "../../lib/classify";
export { THEME_PRESETS, getPreset, type ThemePreset } from "../../lib/themes";
export { detailFromRaw } from "../../lib/detailFromRaw";
export { haversine, nameSimilarity, normalizeName, toNumber } from "../../lib/util";
