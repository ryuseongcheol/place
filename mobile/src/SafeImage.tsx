import { Image, type ImageProps } from "expo-image";
import { useState } from "react";

/**
 * 못 불러온 사진은 빈 칸으로 두지 않고 숨긴다.
 * (원본이 동영상이거나, 지워진 사진, 접근이 막힌 주소일 때)
 */
export default function SafeImage(props: ImageProps) {
  const [bad, setBad] = useState(false);
  if (bad) return null;
  return (
    <Image
      {...props}
      onError={(e) => {
        setBad(true);
        props.onError?.(e);
      }}
    />
  );
}
