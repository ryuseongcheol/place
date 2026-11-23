import { Image, type ImageProps } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { imageCandidates } from "./imageUrl";

/**
 * 사진: 칸 크기에 맞는 작은 사진을 먼저 받고(빠르게), 막히거나 실패하면 다른 주소로 다시 시도한다 (src/imageUrl.ts).
 * 다 실패한 사진은 빈 칸으로 두지 않고 숨긴다 (원본이 동영상이거나, 지워진 사진, 접근이 막힌 주소일 때).
 */
export default function SafeImage({ size, ...props }: ImageProps & { size?: number }) {
  const src = props.source;
  const uri = src && typeof src === "object" && !Array.isArray(src) && "uri" in src && typeof src.uri === "string" ? src.uri : null;
  const candidates = useMemo(() => (uri ? imageCandidates(uri, size) : []), [uri, size]);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [uri, size]);

  if (uri && i >= candidates.length) return null;
  const source = uri ? candidates[i] : src;
  return (
    <Image
      {...props}
      source={source}
      onError={(e) => {
        if (uri && i + 1 < candidates.length) return setI(i + 1);
        setI(candidates.length);
        props.onError?.(e);
      }}
    />
  );
}
