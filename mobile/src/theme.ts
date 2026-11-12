import { useColorScheme } from "react-native";

const light = {
  bg: "#FBF7F2",
  surface: "#FFFFFF",
  surface2: "#F3ECE3",
  text: "#1F1A14",
  muted: "#6F655A",
  line: "#E7DDD0",
  accent: "#D9480F",
  accentSoft: "#FDE8DC",
  kakao: "#7A6000",
  kakaoBg: "#FFF4C2",
  naver: "#03793C",
  naverBg: "#DCF5E6",
  warnBg: "#FFF3D6",
  warnText: "#7A5300",
  errorBg: "#FDE2E2",
  errorText: "#9B1C1C",
};

const dark: typeof light = {
  bg: "#16130F",
  surface: "#211D18",
  surface2: "#2B2620",
  text: "#F3EDE6",
  muted: "#A99D90",
  line: "#3A332B",
  accent: "#FF7A3D",
  accentSoft: "#3D2416",
  kakao: "#FFD84D",
  kakaoBg: "#3A3214",
  naver: "#4FD18B",
  naverBg: "#15331F",
  warnBg: "#3A2E12",
  warnText: "#FFD27A",
  errorBg: "#3D1717",
  errorText: "#FFB4B4",
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
