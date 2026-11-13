import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { fetchPlaceDetail } from "./api";
import { useMyNotes } from "./myNotes";
import { MAX_MY_PHOTOS, deletePhotoFile, pickFromLibrary, takePhoto } from "./myPhotos";
import MyVisits from "./MyVisits";
import PhotoViewer from "./PhotoViewer";
import { lookupNaverPlace, naverBookingUrl, naverMapSearchUrl, naverVisitorReviewUrl, resolveNaverPlaceId } from "./naverDevice";
import { mergeShows, shortArea } from "./shared";
import ShowBadges from "./ShowBadges";
import { callPhone, openKakaoMap, openNaverMap } from "./openMap";
import type { Colors } from "./theme";
import type { PlaceDetail, ScoredPlace } from "./types";
import type { WebTarget } from "./WebViewModal";

export function formatDistance(m: number) {
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

/** 시트 상단(항상 보이는 영역): 이름, 카테고리, 거리, 별점 요약 */
export function PlaceHeader({
  place: p,
  colors: c,
  distance,
  onBack,
  onClose,
}: {
  place: ScoredPlace;
  colors: Colors;
  distance: number | null;
  onBack?: () => void;
  onClose: () => void;
}) {
  const category = p.category.split(">").slice(-1)[0]?.trim();
  return (
    <View style={styles.headerWrap}>
      <View style={styles.headerRow}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="목록으로" style={styles.iconBtn}>
            <Text style={{ fontSize: 24, color: c.text, marginTop: -2 }}>‹</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {p.name} <Text style={{ fontSize: 13, fontWeight: "400", color: c.muted }}>{category}</Text>
          </Text>
          <View style={styles.metaRow}>
            {p.kakao?.rating != null && (
              <Text style={{ fontSize: 13, color: c.text }}>
                <Text style={{ color: "#F5A400" }}>★</Text> {p.kakao.rating.toFixed(1)}
                <Text style={{ color: c.muted }}> ({p.kakao.ratingCount.toLocaleString()})</Text>
              </Text>
            )}
            {!!p.naver?.visitorReviewCount && (
              <Text style={{ fontSize: 13, color: c.muted }}>방문자리뷰 {p.naver.visitorReviewCount.toLocaleString()}</Text>
            )}
            {!!p.naver?.blogReviewCount && <Text style={{ fontSize: 13, color: c.muted }}>블로그 {p.naver.blogReviewCount.toLocaleString()}</Text>}
            {distance != null && <Text style={{ fontSize: 13, color: c.muted }}>{formatDistance(distance)}</Text>}
          </View>
          {!!shortArea(p) && (
            <Text style={{ fontSize: 12, color: c.muted, marginTop: 3 }} numberOfLines={1}>
              📍 {shortArea(p)}
            </Text>
          )}
          <ShowBadges shows={p.shows} />
        </View>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="닫기" style={styles.iconBtn}>
          <Text style={{ fontSize: 18, color: c.muted }}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface BodyProps {
  place: ScoredPlace;
  colors: Colors;
  isFavorite: boolean;
  /** 저장(리스트 고르기) 열기 */
  onSave: () => void;
  openWeb: (t: WebTarget) => void;
}

/** 지번 주소에서 동 이름 (네이버 검색어 보조) */
function dongOf(address: string) {
  return address.split(/\s+/).find((t) => /(동|가|읍|면|리)$/.test(t) && !/^\d/.test(t)) ?? null;
}

/** 시트 본문: 액션 버튼, 사진, 추천 이유, 정보, 메뉴, 리뷰, 블로그 리뷰 */
export function PlaceBody({ place: p, colors: c, isFavorite, onSave, openWeb }: BodyProps) {
  const [findingNaver, setFindingNaver] = useState(false);
  const [findingBooking, setFindingBooking] = useState(false);

  // 네이버 예약: 앱 안 웹뷰에서 예약까지 (네이버 로그인은 한 번 하면 유지)
  const openBooking = async () => {
    const title = `${p.name} 예약`;
    setFindingBooking(true);
    const info = await lookupNaverPlace(p).catch(() => null);
    setFindingBooking(false);
    const naverId = info?.id ?? p.naver?.naverId ?? null;
    if (naverId) openWeb({ title, url: naverBookingUrl(naverId, info?.bookingUrl) });
    else openWeb({ title, url: naverMapSearchUrl(p.name, dongOf(p.address)), naverToBooking: true });
  };
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllMenus, setShowAllMenus] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    setLoading(true);
    setShowAllMenus(false);
    setShowAllReviews(false);
    fetchPlaceDetail({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, naverId: p.naver?.naverId ?? null })
      .then((d) => alive && setDetail(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [p.id, p.name, p.lat, p.lng, p.naver?.naverId]);

  const links = detail?.links;

  // 네이버 방문자 리뷰: 장소 id를 알면 리뷰 탭으로 바로, 모르면 폰에서 찾아보고, 그래도 없으면
  // 네이버 지도 검색을 열되 가게를 누르는 순간 리뷰 탭으로 보낸다 (블로그 검색 결과로 가지 않게)
  const openNaverReviews = async () => {
    const title = `${p.name} 방문자 리뷰`;
    let naverId = p.naver?.naverId ?? null;
    if (!naverId) {
      setFindingNaver(true);
      naverId = await resolveNaverPlaceId(p).catch(() => null);
      setFindingNaver(false);
    }
    if (naverId) openWeb({ title, url: naverVisitorReviewUrl(naverId) });
    else openWeb({ title, url: naverMapSearchUrl(p.name, dongOf(p.address)), naverToReviews: true });
  };

  return (
    <View>
      {/* 액션 버튼 */}
      <View style={[styles.actions, { borderColor: c.line }]}>
        <Action c={c} icon={isFavorite ? "★" : "☆"} label={isFavorite ? "저장됨" : "저장"} active={isFavorite} onPress={onSave} />
        <Action c={c} icon="➜" label="길찾기" onPress={() => openNaverMap(p)} />
        <Action c={c} icon={findingBooking ? "…" : "📅"} label="예약" onPress={openBooking} disabled={findingBooking} />
        <Action c={c} icon="☎" label="전화" disabled={!p.phone} onPress={() => p.phone && callPhone(p.phone)} />
        <Action c={c} icon="K" label="카카오맵" onPress={() => openKakaoMap(p)} />
      </View>

      {/* 상세에서 새로 확인된 방송·가이드 출연 (목록에는 없던 것) */}
      {detail && mergeShows(detail.shows).filter((s) => !(p.shows ?? []).includes(s)).length > 0 && (
        <View style={{ paddingHorizontal: 16 }}>
          <ShowBadges shows={detail.shows.filter((s) => !(p.shows ?? []).includes(s))} />
        </View>
      )}

      {/* 사진 */}
      {loading && !detail ? (
        <View style={[styles.photoSkeleton, { backgroundColor: c.surface2 }]} />
      ) : detail?.photos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
          {detail.photos.map((u, i) => (
            <Pressable key={u} onPress={() => openWeb({ title: `${p.name} 사진`, photos: detail.photos, index: i })} accessibilityLabel={`사진 ${i + 1} 크게 보기`}>
              <Image source={{ uri: u }} style={[i === 0 ? styles.photoBig : styles.photo, { backgroundColor: c.surface2 }]} contentFit="cover" transition={150} />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {detail?.photoSource === "naver" && <Text style={[styles.caption, { color: c.muted }]}>사진: 네이버 이미지 검색 결과</Text>}

      {/* 내 평가: 별점 + 메모 (기기에 저장) */}
      <MyReview place={p} colors={c} />
      {/* 내 방문·결제 기록 (결제 알림 자동 기록 또는 직접 추가) */}
      <MyVisits place={p} colors={c} />

      {/* 추천 이유 (타임라인·저장 기록에서 연 경우엔 없음) */}
      {!!p.reason && (
      <View style={[styles.reasonBox, { backgroundColor: c.accentSoft }]}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: c.accent, marginBottom: 4 }}>
          {p.aiRanked ? `AI 추천 이유 · 적합도 ${p.score}` : `추천 점수 ${p.score}`}
        </Text>
        <Text style={{ fontSize: 14, lineHeight: 21, color: c.text }}>{p.reason}</Text>
        {p.highlights.length > 0 && (
          <View style={styles.tags}>
            {p.highlights.map((h) => (
              <Text key={h} style={[styles.tag, { color: c.accent, borderColor: c.accent }]}>
                {h}
              </Text>
            ))}
          </View>
        )}
      </View>
      )}

      {/* 정보 */}
      <Section c={c} title="정보">
        <InfoRow c={c} label="주소" value={p.roadAddress || p.address} />
        {!!p.phone && <InfoRow c={c} label="전화" value={p.phone} onPress={() => callPhone(p.phone)} />}
        {detail?.openHours.length ? <InfoRow c={c} label="영업" value={detail.openHours.join("\n")} /> : null}
        {detail?.homepage ? <InfoRow c={c} label="홈페이지" value={detail.homepage} onPress={() => openWeb({ url: detail.homepage!, title: p.name })} /> : null}
      </Section>

      {error && (
        <Text style={[styles.errorText, { color: c.errorText, backgroundColor: c.errorBg }]}>상세 정보를 불러오지 못했어요: {error}</Text>
      )}
      {loading && (
        <View style={{ paddingVertical: 24, alignItems: "center" }}>
          <ActivityIndicator color={c.accent} />
        </View>
      )}

      {/* 메뉴 */}
      {detail && (
        <Section c={c} title={`메뉴${detail.menus.length ? ` ${detail.menus.length}` : ""}`}>
          {detail.menus.length === 0 ? (
            <Text style={[styles.empty, { color: c.muted }]}>메뉴 정보가 없어요.</Text>
          ) : (
            <>
              {(showAllMenus ? detail.menus : detail.menus.slice(0, 5)).map((m) => (
                <View key={m.name} style={[styles.menuRow, { borderBottomColor: c.line }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, color: c.text }}>{m.name}</Text>
                    {m.price && <Text style={{ fontSize: 14, fontWeight: "700", color: c.text, marginTop: 2 }}>{m.price}</Text>}
                  </View>
                  {m.image && <Image source={{ uri: m.image }} style={[styles.menuImg, { backgroundColor: c.surface2 }]} contentFit="cover" />}
                </View>
              ))}
              {detail.menus.length > 5 && (
                <MoreButton c={c} label={showAllMenus ? "접기" : `메뉴 ${detail.menus.length - 5}개 더보기`} onPress={() => setShowAllMenus((v) => !v)} />
              )}
            </>
          )}
        </Section>
      )}

      {/* 리뷰 */}
      {detail && (
        <Section c={c} title="리뷰">
          {/* 네이버 방문자 리뷰: 본문은 공식 API가 없어 웹뷰로 */}
          <Pressable
            style={[styles.sourceCard, { backgroundColor: c.naverBg }]}
            onPress={openNaverReviews}
            disabled={findingNaver}
            accessibilityRole="link"
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: c.naver }}>
                네이버 방문자 리뷰 {p.naver?.visitorReviewCount ? p.naver.visitorReviewCount.toLocaleString() : ""}
              </Text>
              {!!p.naver?.keywords.length && (
                <Text style={{ fontSize: 12, color: c.naver, marginTop: 4 }} numberOfLines={2}>
                  {p.naver.keywords.map((k) => `"${k}"`).join("  ")}
                </Text>
              )}
            </View>
            {findingNaver ? <ActivityIndicator color={c.naver} /> : <Text style={{ color: c.naver, fontSize: 13, fontWeight: "600" }}>보기 ›</Text>}
          </Pressable>

          {/* 카카오맵 후기 */}
          <View style={[styles.subHead]}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: c.text }}>
              카카오맵 후기{" "}
              {p.kakao?.rating != null && (
                <Text style={{ fontWeight: "400" }}>
                  <Text style={{ color: "#F5A400" }}>★</Text> {p.kakao.rating.toFixed(1)} · {p.kakao.ratingCount.toLocaleString()}명
                </Text>
              )}
            </Text>
          </View>
          {detail.kakaoReviews.length === 0 ? (
            <Text style={[styles.empty, { color: c.muted }]}>
              {detail.sources.kakaoDetail === "failed" ? "카카오맵 후기를 불러오지 못했어요." : "후기가 없어요."}
            </Text>
          ) : (
            (showAllReviews ? detail.kakaoReviews : detail.kakaoReviews.slice(0, 3)).map((r, i) => (
              <View key={i} style={[styles.review, { borderBottomColor: c.line }]}>
                <Text style={{ fontSize: 12, color: c.muted }}>
                  {r.rating != null && <Text style={{ color: "#F5A400" }}>{"★".repeat(Math.round(r.rating))} </Text>}
                  {[r.author, r.date].filter(Boolean).join(" · ")}
                </Text>
                <Text style={{ fontSize: 14, lineHeight: 21, color: c.text, marginTop: 4 }}>{r.text}</Text>
                {r.photos.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 8 }}>
                    {r.photos.map((u) => (
                      <Image key={u} source={{ uri: u }} style={[styles.reviewImg, { backgroundColor: c.surface2 }]} contentFit="cover" />
                    ))}
                  </ScrollView>
                )}
              </View>
            ))
          )}
          {detail.kakaoReviews.length > 3 && !showAllReviews && <MoreButton c={c} label="후기 더보기" onPress={() => setShowAllReviews(true)} />}
          <MoreButton c={c} label="카카오맵에서 전체 후기 보기 ›" onPress={() => openWeb({ url: detail.links.kakaoReviews, title: `${p.name} 카카오맵 후기` })} />
        </Section>
      )}

      {/* 블로그 리뷰 */}
      {detail && (
        <Section c={c} title={`블로그 리뷰${detail.blogReviewTotal ? ` ${detail.blogReviewTotal.toLocaleString()}` : ""}`}>
          {detail.blogReviews.length === 0 ? (
            <Text style={[styles.empty, { color: c.muted }]}>
              {detail.sources.naverBlog === "disabled"
                ? "네이버 검색 API 키가 없어 블로그 리뷰를 불러오지 않았어요."
                : "관련 블로그 글을 찾지 못했어요."}
            </Text>
          ) : (
            detail.blogReviews.slice(0, 8).map((b) => (
              <Pressable
                key={b.url}
                style={[styles.blog, { borderBottomColor: c.line }]}
                onPress={() => openWeb({ url: b.url, title: b.title })}
                accessibilityRole="link"
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: c.text }} numberOfLines={2}>
                    {b.title}
                  </Text>
                  {!!b.snippet && (
                    <Text style={{ fontSize: 13, lineHeight: 19, color: c.muted, marginTop: 4 }} numberOfLines={2}>
                      {b.snippet}
                    </Text>
                  )}
                  <Text style={{ fontSize: 12, color: c.muted, marginTop: 6 }}>
                    {[b.blogger, b.date, b.source === "kakao" ? "카카오맵" : "네이버 블로그"].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                {b.thumbnail && <Image source={{ uri: b.thumbnail }} style={[styles.blogImg, { backgroundColor: c.surface2 }]} contentFit="cover" />}
              </Pressable>
            ))
          )}
          <MoreButton c={c} label="네이버에서 블로그 리뷰 더보기 ›" onPress={() => openWeb({ url: detail.links.naverBlogReviews, title: `${p.name} 블로그 리뷰` })} />
        </Section>
      )}

      <Text style={[styles.foot, { color: c.muted }]}>
        사진·메뉴·후기는 카카오맵·네이버의 공개 정보를 참고용으로 보여주며 실제와 다를 수 있어요.
      </Text>
    </View>
  );
}

function Action({ c, icon, label, onPress, active, disabled }: { c: Colors; icon: string; label: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.action, disabled && { opacity: 0.35 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={{ fontSize: 20, color: active ? "#F5A400" : c.text, fontWeight: "700" }}>{icon}</Text>
      <Text style={{ fontSize: 12, color: c.text, marginTop: 3 }}>{label}</Text>
    </Pressable>
  );
}

function Section({ c, title, children }: { c: Colors; title: string; children: React.ReactNode }) {
  return (
    <View style={[styles.section, { borderTopColor: c.surface2 }]}>
      <Text style={[styles.sectionTitle, { color: c.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({ c, label, value, onPress }: { c: Colors; label: string; value: string; onPress?: () => void }) {
  const body = (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: c.muted }]}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: onPress ? c.accent : c.text }}>{value}</Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

function MoreButton({ c, label, onPress }: { c: Colors; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.more, { borderColor: c.line }]} accessibilityRole="button">
      <Text style={{ fontSize: 13, color: c.text, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerWrap: { paddingHorizontal: 16, paddingBottom: 10 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  iconBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 2, marginTop: 4 },
  actions: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, marginHorizontal: 16, paddingVertical: 10 },
  action: { flex: 1, alignItems: "center", paddingVertical: 4 },
  photos: { gap: 6, paddingHorizontal: 16, paddingTop: 12 },
  photoBig: { width: 220, height: 160, borderRadius: 10 },
  photo: { width: 120, height: 160, borderRadius: 10 },
  photoSkeleton: { height: 160, marginHorizontal: 16, marginTop: 12, borderRadius: 10 },
  caption: { fontSize: 11, paddingHorizontal: 16, marginTop: 4 },
  myPhotos: { gap: 8, paddingTop: 8 },
  myPhoto: { width: 72, height: 72, borderRadius: 8 },
  myPhotoDel: { position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  myPhotoAdd: { width: 72, height: 72, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  myBox: { marginHorizontal: 16, marginTop: 14, borderRadius: 12, borderWidth: 1, padding: 12 },
  stars: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 6 },
  memo: { borderWidth: 1, borderRadius: 10, padding: 10, minHeight: 64, fontSize: 14, textAlignVertical: "top", marginTop: 8 },
  memoBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  reasonBox: { marginHorizontal: 16, marginTop: 14, borderRadius: 12, padding: 12 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tag: { fontSize: 12, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  section: { borderTopWidth: 8, marginTop: 16, paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontSize: 17, fontWeight: "800", marginBottom: 10 },
  infoRow: { flexDirection: "row", paddingVertical: 6, gap: 12 },
  infoLabel: { width: 56, fontSize: 13, lineHeight: 20 },
  empty: { fontSize: 13, paddingVertical: 8 },
  errorText: { marginHorizontal: 16, marginTop: 12, padding: 10, borderRadius: 8, fontSize: 13 },
  menuRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  menuImg: { width: 64, height: 64, borderRadius: 8 },
  sourceCard: { flexDirection: "row", alignItems: "center", borderRadius: 12, padding: 12, gap: 8 },
  subHead: { marginTop: 16, marginBottom: 4 },
  review: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  reviewImg: { width: 72, height: 72, borderRadius: 6 },
  blog: { flexDirection: "row", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  blogImg: { width: 76, height: 76, borderRadius: 8 },
  more: { borderWidth: 1, borderRadius: 10, paddingVertical: 11, alignItems: "center", marginTop: 12 },
  foot: { fontSize: 11, textAlign: "center", marginTop: 24, paddingHorizontal: 24, lineHeight: 17 },
});

/** 내 별점(1~5)과 메모. 같은 별을 다시 누르면 별점 지우기 */
function MyReview({ place: p, colors: c }: { place: ScoredPlace; colors: Colors }) {
  const notes = useMyNotes();
  const mine = notes.get(p.id);
  const [memo, setMemo] = useState(mine?.memo ?? "");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    setMemo(notes.get(p.id)?.memo ?? "");
    setSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);
  // 예전 평가에 식당 정보가 없으면 채워서 타임라인에서 다시 열 수 있게
  useEffect(() => {
    notes.attachPlace(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, !!mine]);
  const dirty = memo !== (mine?.memo ?? "");
  const photos = mine?.photos ?? [];
  const [viewer, setViewer] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const addPhotos = (from: "library" | "camera") => async () => {
    const remaining = MAX_MY_PHOTOS - photos.length;
    if (remaining <= 0) return;
    setAdding(true);
    try {
      const added = from === "library" ? await pickFromLibrary(p.id, remaining) : await takePhoto(p.id);
      if (added.length) notes.save(p, { photos: [...(notes.get(p.id)?.photos ?? []), ...added].slice(0, MAX_MY_PHOTOS) });
    } catch (e) {
      Alert.alert("사진을 추가하지 못했어요", e instanceof Error ? e.message : "");
    } finally {
      setAdding(false);
    }
  };
  const askAdd = () =>
    // 웹(미리보기)에서는 선택 버튼이 있는 알림창이 없어 바로 앨범을 연다
    Platform.OS === "web"
      ? addPhotos("library")()
      : Alert.alert("사진 추가", `최대 ${MAX_MY_PHOTOS}장 (지금 ${photos.length}장)`, [
      { text: "앨범에서 고르기", onPress: addPhotos("library") },
      { text: "사진 찍기", onPress: addPhotos("camera") },
      { text: "취소", style: "cancel" },
    ]);
  const removePhoto = (uri: string) =>
    Alert.alert("사진 삭제", "이 사진을 내 평가에서 지울까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => {
          notes.save(p, { photos: photos.filter((u) => u !== uri) });
          deletePhotoFile(uri);
        },
      },
    ]);

  return (
    <View style={[styles.myBox, { borderColor: c.line, backgroundColor: c.surface }]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 14, fontWeight: "800", color: c.text }}>내 평가</Text>
        {mine?.updatedAt ? (
          <Text style={{ fontSize: 11, color: c.muted }}>{new Date(mine.updatedAt).toLocaleDateString("ko-KR")}</Text>
        ) : null}
      </View>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = (mine?.rating ?? 0) >= n;
          return (
            <Pressable
              key={n}
              onPress={() => notes.save(p, { rating: mine?.rating === n ? null : n })}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`내 별점 ${n}점`}
            >
              <Text style={{ fontSize: 30, color: on ? "#F5A400" : c.line }}>★</Text>
            </Pressable>
          );
        })}
        {mine?.rating ? <Text style={{ marginLeft: 8, color: c.muted, fontSize: 13 }}>{mine.rating}점</Text> : null}
      </View>
      {/* 내 사진 (여러 장) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.myPhotos} keyboardShouldPersistTaps="handled">
        {photos.map((u, i) => (
          <View key={u}>
            <Pressable onPress={() => setViewer(i)} accessibilityLabel={`내 사진 ${i + 1} 크게 보기`}>
              <Image source={{ uri: u }} style={[styles.myPhoto, { backgroundColor: c.surface2 }]} contentFit="cover" />
            </Pressable>
            <Pressable onPress={() => removePhoto(u)} style={styles.myPhotoDel} hitSlop={8} accessibilityLabel="사진 삭제">
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>✕</Text>
            </Pressable>
          </View>
        ))}
        {photos.length < MAX_MY_PHOTOS && (
          <Pressable onPress={askAdd} disabled={adding} style={[styles.myPhotoAdd, { borderColor: c.line }]} accessibilityRole="button" accessibilityLabel="사진 추가">
            {adding ? <ActivityIndicator color={c.accent} /> : <Text style={{ fontSize: 22, color: c.muted }}>＋</Text>}
            <Text style={{ fontSize: 11, color: c.muted }}>사진 {photos.length}/{MAX_MY_PHOTOS}</Text>
          </Pressable>
        )}
      </ScrollView>
      <PhotoViewer photos={viewer !== null ? photos : null} index={viewer ?? 0} onClose={() => setViewer(null)} />
      <TextInput
        value={memo}
        onChangeText={setMemo}
        placeholder="메모 (예: 순대국 진함, 점심엔 웨이팅 10분)"
        placeholderTextColor={c.muted}
        multiline
        maxLength={500}
        style={[styles.memo, { color: c.text, borderColor: c.line, backgroundColor: c.bg }]}
      />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
        {savedAt && !dirty ? <Text style={{ fontSize: 12, color: c.naver }}>저장됨</Text> : null}
        <Pressable
          onPress={() => {
            notes.save(p, { memo: memo.trim() });
            setSavedAt(Date.now());
          }}
          disabled={!dirty}
          style={[styles.memoBtn, { backgroundColor: dirty ? c.accent : c.surface2 }]}
          accessibilityRole="button"
        >
          <Text style={{ color: dirty ? "#fff" : c.muted, fontWeight: "700", fontSize: 13 }}>메모 저장</Text>
        </Pressable>
      </View>
    </View>
  );
}
