"use client";

import { useCallback, useEffect, useState } from "react";
import KakaoMap, { mapAvailable } from "./KakaoMap";
import type { RecommendResponse, ScoredPlace, SourceStatus } from "@/lib/types";

interface PresetChip {
  id: string;
  label: string;
  emoji: string;
}

type LocState =
  | { status: "idle" | "locating" }
  | { status: "ok"; lat: number; lng: number; fallback: boolean }
  | { status: "denied"; lat: number; lng: number; fallback: true; message: string };

// 위치 권한이 없을 때 쓰는 기본 위치 (강남역)
const FALLBACK = { lat: 37.4979, lng: 127.0276 };
const RADII = [500, 1000, 2000];

export default function Home() {
  const [presets, setPresets] = useState<PresetChip[]>([]);
  const [meta, setMeta] = useState<{ ai: boolean; mock: boolean } | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [radius, setRadius] = useState(1000);
  const [loc, setLoc] = useState<LocState>({ status: "idle" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RecommendResponse | null>(null);

  useEffect(() => {
    fetch("/api/themes")
      .then((r) => r.json())
      .then((d) => {
        setPresets(d.presets);
        setMeta({ ai: d.ai, mock: d.mock });
      })
      .catch(() => setPresets([]));
  }, []);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLoc({ status: "denied", ...FALLBACK, fallback: true, message: "이 브라우저는 위치 기능을 지원하지 않아요." });
      return;
    }
    setLoc({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => setLoc({ status: "ok", lat: pos.coords.latitude, lng: pos.coords.longitude, fallback: false }),
      (err) =>
        setLoc({
          status: "denied",
          ...FALLBACK,
          fallback: true,
          message:
            err.code === err.PERMISSION_DENIED
              ? "위치 권한이 거부되어 강남역 기준으로 보여드려요."
              : "위치를 가져오지 못해 강남역 기준으로 보여드려요.",
        }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  const hasPosition = loc.status === "ok" || loc.status === "denied";
  const canSearch = hasPosition && !loading && (presetId !== null || text.trim().length > 0);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!hasPosition) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: loc.lat, lng: loc.lng, radius, presetId, text: text.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "추천을 불러오지 못했어요.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "추천을 불러오지 못했어요.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="wrap">
      <header className="brand">
        <h1>
          근처<span>맛집</span>
        </h1>
        <small>카카오맵 · 네이버지도 리뷰 기반</small>
      </header>

      <form className="panel" onSubmit={search}>
        <div className="loc" aria-live="polite">
          <div className="where">
            <span className={`dot ${loc.status === "ok" ? "on" : ""}`} aria-hidden />
            <b>
              {loc.status === "idle" || loc.status === "locating"
                ? "현재 위치 확인 중…"
                : loc.status === "ok"
                  ? "현재 위치 기준"
                  : "강남역 기준 (기본 위치)"}
            </b>
          </div>
          <button type="button" className="ghost" onClick={locate} disabled={loc.status === "locating"}>
            위치 다시 찾기
          </button>
        </div>
        {loc.status === "denied" && <div className="notice">{loc.message}</div>}

        <div className="label" id="theme-label">
          어떤 식당을 찾으세요?
        </div>
        <div className="chips" role="group" aria-labelledby="theme-label">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              aria-pressed={presetId === p.id}
              onClick={() => setPresetId(presetId === p.id ? null : p.id)}
            >
              <span aria-hidden>{p.emoji}</span> {p.label}
            </button>
          ))}
        </div>

        <label className="label" htmlFor="free-text" style={{ display: "block" }}>
          원하는 걸 자유롭게 적어도 돼요 {meta && !meta.ai && <span>(AI 미연결: 검색어로 사용)</span>}
        </label>
        <input
          id="free-text"
          className="text-input"
          placeholder="예: 비 오는 날 혼자 조용히 먹을 따뜻한 국물"
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          enterKeyHint="search"
        />

        <div className="row">
          <div className="seg" role="group" aria-label="검색 반경">
            {RADII.map((r) => (
              <button key={r} type="button" aria-pressed={radius === r} onClick={() => setRadius(r)}>
                {r < 1000 ? `${r}m` : `${r / 1000}km`}
              </button>
            ))}
          </div>
          <button type="submit" className="primary" disabled={!canSearch}>
            {loading ? "리뷰 분석 중…" : "추천 받기"}
          </button>
        </div>
        {!presetId && !text.trim() && hasPosition && (
          <p className="meta" style={{ marginTop: 10 }}>
            테마를 고르거나 원하는 걸 입력하면 추천을 받을 수 있어요.
          </p>
        )}
        {error && <div className="notice error" role="alert">{error}</div>}
      </form>

      <section aria-live="polite" aria-busy={loading}>
        {loading && (
          <div className="list" style={{ marginTop: 24 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" />
            ))}
          </div>
        )}
        {!loading && data && hasPosition && <Results data={data} center={{ lat: loc.lat, lng: loc.lng }} />}
      </section>

      <p className="foot">
        별점·리뷰 수는 카카오맵·네이버지도의 공개 정보를 참고용으로 가져온 것이며 실제와 다를 수 있어요.
        <br />
        자세한 리뷰는 각 지도 앱에서 확인하세요.
      </p>
    </main>
  );
}

const SOURCE_LABEL: Record<keyof RecommendResponse["sources"], string> = {
  kakaoSearch: "카카오 검색",
  kakaoReviews: "카카오 별점",
  naverReviews: "네이버 리뷰",
  ai: "AI 추천",
};
const STATUS_LABEL: Record<SourceStatus, string> = {
  ok: "정상",
  partial: "일부",
  failed: "실패",
  disabled: "꺼짐",
  mock: "예시",
};

function Results({ data, center }: { data: RecommendResponse; center: { lat: number; lng: number } }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const select = useCallback((id: string) => {
    setSelectedId(id);
    document.getElementById(`place-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);
  return (
    <>
      <p className="summary">
        <b>{data.query.summary}</b>
        {data.region && <> · {data.region}</>}
        <br />
        검색어: {data.query.keywords.join(", ")}
      </p>
      <div className="sources">
        {(Object.keys(data.sources) as Array<keyof RecommendResponse["sources"]>).map((k) => (
          <span key={k} className={`src ${data.sources[k] === "ok" ? "ok" : data.sources[k] === "failed" ? "failed" : ""}`}>
            {SOURCE_LABEL[k]} {STATUS_LABEL[data.sources[k]]}
          </span>
        ))}
      </div>
      {data.warnings.map((w) => (
        <div key={w} className="notice" style={{ marginTop: 0, marginBottom: 12 }}>
          {w}
        </div>
      ))}
      {mapAvailable() && data.places.length > 0 && (
        <KakaoMap center={center} places={data.places} selectedId={selectedId} onSelect={select} />
      )}
      {data.places.length === 0 ? (
        <div className="empty">
          조건에 맞는 식당을 찾지 못했어요.
          <br />
          반경을 넓히거나 다른 테마로 찾아보세요.
        </div>
      ) : (
        <ol className="list">
          {data.places.map((p, i) => (
            <PlaceCard key={p.id} place={p} rank={i + 1} selected={p.id === selectedId} onFocus={() => setSelectedId(p.id)} />
          ))}
        </ol>
      )}
    </>
  );
}

function formatDistance(m: number) {
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

function PlaceCard({
  place: p,
  rank,
  selected,
  onFocus,
}: {
  place: ScoredPlace;
  rank: number;
  selected: boolean;
  onFocus: () => void;
}) {
  const category = p.category.split(">").slice(-2).join(" · ").trim();
  const walkMin = Math.max(1, Math.round(p.distance / 70));
  const naverUrl = p.naver?.naverUrl ?? `https://map.naver.com/p/search/${encodeURIComponent(p.name)}`;
  const snippets = p.kakao?.snippets ?? [];

  return (
    <li id={`place-${p.id}`} className={`card${selected ? " selected" : ""}`} onClick={onFocus}>
      <div className="card-head">
        <span className="rank">{rank}</span>
        <div style={{ minWidth: 0 }}>
          <h2>{p.name}</h2>
          <div className="meta">
            {category} · {formatDistance(p.distance)} (도보 약 {walkMin}분)
          </div>
        </div>
        <div className="score" title={`평점 ${p.scoreBreakdown.rating} · 인기 ${p.scoreBreakdown.popularity} · 관련도 ${p.scoreBreakdown.relevance} · 거리 ${p.scoreBreakdown.distance}`}>
          <b>{p.score}</b>
          <small>{p.aiRanked ? "AI 적합도" : "추천 점수"}</small>
        </div>
      </div>

      <div className="badges">
        {p.kakao?.rating != null ? (
          <span className="badge kakao">
            카카오 ★ {p.kakao.rating.toFixed(1)} <span style={{ fontWeight: 400 }}>({p.kakao.ratingCount.toLocaleString()})</span>
          </span>
        ) : (
          <span className="badge none">카카오 별점 없음</span>
        )}
        {p.naver && (p.naver.visitorReviewCount > 0 || p.naver.blogReviewCount > 0) ? (
          <span className="badge naver">
            네이버 {p.naver.rating ? `★ ${p.naver.rating.toFixed(1)} · ` : ""}방문자 {p.naver.visitorReviewCount.toLocaleString()} · 블로그{" "}
            {p.naver.blogReviewCount.toLocaleString()}
          </span>
        ) : (
          <span className="badge none">네이버 리뷰 정보 없음</span>
        )}
      </div>

      <p className="reason">{p.reason}</p>

      {p.highlights.length > 0 && (
        <div className="tags">
          {p.highlights.map((h) => (
            <span key={h} className="tag">
              {h}
            </span>
          ))}
        </div>
      )}

      {snippets.length > 0 && (
        <details className="reviews">
          <summary>카카오맵 후기 {snippets.length}개 보기</summary>
          <ul>
            {snippets.slice(0, 4).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="links">
        <a className="k" href={p.kakaoUrl} target="_blank" rel="noopener noreferrer">
          카카오맵에서 보기
        </a>
        <a className="n" href={naverUrl} target="_blank" rel="noopener noreferrer">
          네이버지도에서 보기
        </a>
      </div>
    </li>
  );
}
