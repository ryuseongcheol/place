import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Image } from "expo-image";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { openNotificationAccessSettings } from "../modules/payment-notifications";
import { dayKey, dayLabel, monthStart, shortDate, timeLabel, won } from "./dates";
import { useFavorites } from "./favorites";
import { useMyNotes, type MyNote } from "./myNotes";
import { usePaymentAccess } from "./paymentAccess";
import { searchPlacesByName, type PlaceCandidate } from "./api";
import { confirmPaymentPlace, removePayment, setPaymentPlace, syncPayments, syncResultText, updatePayment, usePayments, type PaymentRecord } from "./payments";
import PhotoViewer from "./PhotoViewer";
import { snapOf, type PlaceSnap } from "./placeSnap";
import { categoryIcon } from "./shared";
import type { Colors } from "./theme";

type Tab = "time" | "place";
type Filter = "all" | "review" | "pay";

/** 하루 · 한 가게 카드 */
interface DayCard {
  key: string;
  day: string;
  at: number;
  placeId: string | null;
  place: PlaceSnap | null;
  name: string;
  category: string;
  pays: PaymentRecord[];
  note: MyNote | null;
  /** 가게를 못 찾았거나 음식점이 아닌 결제 */
  orphan?: PaymentRecord;
}

type Row = { type: "day"; key: string; label: string; total: number } | { type: "card"; key: string; card: DayCard };

interface PlaceSummary {
  key: string;
  place: PlaceSnap | null;
  name: string;
  category: string;
  visits: number;
  total: number;
  lastAt: number;
  note: MyNote | null;
}

const paid = (p: PaymentRecord) => (p.canceled ? 0 : p.amount);

interface Props {
  visible: boolean;
  onClose: () => void;
  onOpenPlace: (place: PlaceSnap) => void;
  colors: Colors;
  me: { lat: number; lng: number } | null;
}

export default function TimelineScreen({ visible, onClose, onOpenPlace, colors: c, me }: Props) {
  const { list } = usePayments();
  const notes = useMyNotes();
  const fav = useFavorites();
  const access = usePaymentAccess();
  const [tab, setTab] = useState<Tab>("time");
  const [filter, setFilter] = useState<Filter>("all");
  const [showHidden, setShowHidden] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [fixing, setFixing] = useState<PaymentRecord | null>(null);
  const [viewer, setViewer] = useState<{ photos: string[]; index: number } | null>(null);

  /** 저장된 식당 정보 찾기: 평가 기록 → 저장 리스트 */
  const placeOf = (id: string, note?: MyNote | null): PlaceSnap | null => {
    if (note?.place) return note.place;
    const f = fav.items.find((it) => it.place.id === id);
    return f ? snapOf(f.place) : null;
  };

  const visiblePays = useMemo(
    () => list.filter((p) => (showHidden ? true : !p.hidden && p.status !== "notFood")),
    [list, showHidden],
  );
  const hiddenCount = list.length - list.filter((p) => !p.hidden && p.status !== "notFood").length;

  // ----- 시간순: 날짜 → 가게별 카드 -----
  const rows = useMemo<Row[]>(() => {
    const cards = new Map<string, DayCard>();
    const card = (day: string, at: number, placeId: string | null, place: PlaceSnap | null, name: string, category: string) => {
      const key = `${day}|${placeId ?? name}`;
      let cd = cards.get(key);
      if (!cd) {
        cd = { key, day, at, placeId, place, name, category, pays: [], note: null };
        cards.set(key, cd);
      }
      cd.at = Math.max(cd.at, at);
      return cd;
    };
    if (filter !== "review") {
      for (const p of visiblePays) {
        if (p.status === "matched" && p.place) {
          card(dayKey(p.at), p.at, p.place.id, p.place, p.place.name, p.place.category).pays.push(p);
        } else {
          const key = `${dayKey(p.at)}|orphan:${p.id}`;
          cards.set(key, {
            key,
            day: dayKey(p.at),
            at: p.at,
            placeId: null,
            place: p.place ?? null,
            name: p.place?.name ?? p.merchant ?? "가맹점 이름 없음",
            category: p.reason ?? "",
            pays: [p],
            note: null,
            orphan: p,
          });
        }
      }
    }
    if (filter !== "pay") {
      for (const [id, n] of Object.entries(notes.notes)) {
        const at = n.createdAt ?? n.updatedAt;
        // 방문(결제) 후 3일 안에 남긴 평가는 그 방문 날짜에 붙인다
        const visit = list
          .filter((p) => p.place?.id === id && p.status === "matched" && !p.hidden && p.at <= at && at - p.at < 3 * 86400000)
          .sort((a, b) => b.at - a.at)[0];
        const place = placeOf(id, n);
        const day = dayKey(visit?.at ?? at);
        const cd = card(day, visit?.at ?? at, id, place, n.name, place?.category ?? "");
        cd.note = n;
      }
    }
    const sorted = [...cards.values()].sort((a, b) => b.at - a.at);
    const out: Row[] = [];
    let lastDay = "";
    for (const cd of sorted) {
      if (cd.day !== lastDay) {
        lastDay = cd.day;
        const total = sorted.filter((x) => x.day === cd.day && !x.orphan).reduce((s, x) => s + x.pays.reduce((t, p) => t + paid(p), 0), 0);
        out.push({ type: "day", key: `d:${cd.day}`, label: dayLabel(cd.at), total });
      }
      out.push({ type: "card", key: cd.key, card: cd });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePays, notes.notes, filter, fav.items]);

  // ----- 맛집별 -----
  const places = useMemo<PlaceSummary[]>(() => {
    const m = new Map<string, PlaceSummary>();
    const get = (id: string, place: PlaceSnap | null, name: string) => {
      let s = m.get(id);
      if (!s) {
        s = { key: id, place, name, category: place?.category ?? "", visits: 0, total: 0, lastAt: 0, note: null };
        m.set(id, s);
      }
      if (!s.place && place) {
        s.place = place;
        s.category = place.category;
      }
      return s;
    };
    if (filter !== "review") {
      const days = new Map<string, Set<string>>();
      for (const p of list) {
        if (p.status !== "matched" || !p.place || p.hidden) continue;
        const s = get(p.place.id, p.place, p.place.name);
        s.total += paid(p);
        s.lastAt = Math.max(s.lastAt, p.at);
        if (!p.canceled) {
          const d = days.get(p.place.id) ?? new Set<string>();
          d.add(dayKey(p.at));
          days.set(p.place.id, d);
        }
      }
      for (const [id, d] of days) m.get(id)!.visits = d.size;
    }
    if (filter !== "pay") {
      for (const [id, n] of Object.entries(notes.notes)) {
        const s = get(id, placeOf(id, n), n.name);
        s.note = n;
        s.lastAt = Math.max(s.lastAt, n.updatedAt);
      }
    }
    return [...m.values()].sort((a, b) => b.lastAt - a.lastAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, notes.notes, filter, fav.items]);

  // ----- 이번 달 -----
  const month = useMemo(() => {
    const from = monthStart();
    const pays = list.filter((p) => p.status === "matched" && !p.hidden && !p.canceled && p.at >= from);
    const visits = new Set(pays.map((p) => `${dayKey(p.at)}|${p.place?.id}`)).size;
    const reviews = Object.values(notes.notes).filter((n) => (n.createdAt ?? n.updatedAt) >= from).length;
    return { visits, total: pays.reduce((s, p) => s + p.amount, 0), reviews };
  }, [list, notes.notes]);

  const refresh = async () => {
    setSyncing(true);
    try {
      setSyncMsg(syncResultText(await syncPayments({ fallbackLoc: me, force: true, scan: true })));
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "가져오지 못했어요");
    } finally {
      setSyncing(false);
    }
  };

  const open = (place: PlaceSnap | null) => {
    if (!place) return;
    onClose();
    onOpenPlace(place);
  };

  const renderCard = (cd: DayCard) => {
    const ic = categoryIcon(cd.category, cd.name);
    const photos = cd.note?.photos ?? [];
    if (cd.orphan) {
      const p = cd.orphan;
      return (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line, opacity: p.hidden || p.status === "notFood" ? 0.6 : 1 }]}>
          <View style={styles.cardTop}>
            <View style={[styles.icon, { backgroundColor: c.surface2 }]}>
              <MaterialCommunityIcons name={p.status === "pending" ? "progress-clock" : "help"} size={18} color={c.muted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: c.text }} numberOfLines={1}>
                {cd.name}
              </Text>
              <Text style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
                {p.status === "pending" ? "가게 찾는 중" : p.status === "notFood" ? `음식점 아님 · ${p.reason ?? ""}` : "가게를 찾지 못했어요"}
              </Text>
            </View>
          </View>
          <PayLine p={p} c={c} />
          <View style={styles.cardActions}>
            <Pressable onPress={() => setFixing(p)} hitSlop={6}>
              <Text style={{ color: c.accent, fontSize: 13, fontWeight: "700" }}>장소 고르기</Text>
            </Pressable>
            {p.status === "notFood" && p.place && (
              <Pressable onPress={() => updatePayment(p.id, { status: "matched", hidden: false })} hitSlop={6}>
                <Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>맛집으로 기록</Text>
              </Pressable>
            )}
            {!p.hidden ? (
              <Pressable onPress={() => updatePayment(p.id, { hidden: true })} hitSlop={6}>
                <Text style={{ color: c.muted, fontSize: 13, fontWeight: "600" }}>숨기기</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => updatePayment(p.id, { hidden: false })} hitSlop={6}>
                <Text style={{ color: c.muted, fontSize: 13, fontWeight: "600" }}>다시 보이기</Text>
              </Pressable>
            )}
          </View>
        </View>
      );
    }
    return (
      <Pressable
        onPress={() => open(cd.place)}
        disabled={!cd.place}
        style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}
        accessibilityRole="button"
        accessibilityLabel={`${cd.name} 상세 보기`}
      >
        <View style={styles.cardTop}>
          <View style={[styles.icon, { backgroundColor: ic.color }]}>
            <MaterialCommunityIcons name={ic.glyph as never} size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: c.text }} numberOfLines={1}>
              {cd.name} <Text style={{ fontSize: 12, fontWeight: "400", color: c.muted }}>{cd.category.split(">").slice(-1)[0]?.trim()}</Text>
            </Text>
            {cd.place && (
              <Text style={{ fontSize: 12, color: c.muted, marginTop: 2 }} numberOfLines={1}>
                {(cd.place.roadAddress || cd.place.address).split(" ").slice(1, 4).join(" ")}
              </Text>
            )}
          </View>
          {cd.place && <Text style={{ color: c.muted, fontSize: 18 }}>›</Text>}
        </View>
        {cd.pays
          .sort((a, b) => a.at - b.at)
          .map((p) => (
            <PayLine key={p.id} p={p} c={c} onEdit={() => setFixing(p)} />
          ))}
        {cd.pays.some((p) => p.needsCheck) && (
          <View style={[styles.check, { backgroundColor: c.warnBg }]}>
            <Text style={{ color: c.warnText, fontSize: 13, lineHeight: 19 }}>같은 이름의 가게가 여러 곳이에요. 이 지점이 맞나요?</Text>
            <View style={{ flexDirection: "row", gap: 16, marginTop: 6 }}>
              <Pressable onPress={() => cd.pays.filter((p) => p.needsCheck).forEach((p) => confirmPaymentPlace(p.id))} hitSlop={6}>
                <Text style={{ color: c.warnText, fontSize: 13, fontWeight: "800" }}>맞아요</Text>
              </Pressable>
              <Pressable onPress={() => setFixing(cd.pays.find((p) => p.needsCheck) ?? null)} hitSlop={6}>
                <Text style={{ color: c.warnText, fontSize: 13, fontWeight: "800" }}>다른 지점 고르기</Text>
              </Pressable>
            </View>
          </View>
        )}
        {cd.note && (
          <View style={{ marginTop: 8 }}>
            {cd.note.rating ? (
              <Text style={{ fontSize: 14, color: "#F5A400", letterSpacing: 1 }}>
                {"★".repeat(cd.note.rating)}
                <Text style={{ color: c.line }}>{"★".repeat(5 - cd.note.rating)}</Text>
              </Text>
            ) : null}
            {!!cd.note.memo && (
              <Text style={{ fontSize: 13, lineHeight: 19, color: c.text, marginTop: 4 }} numberOfLines={3}>
                {cd.note.memo}
              </Text>
            )}
            {photos.length > 0 && (
              <View style={styles.photos}>
                {photos.slice(0, 4).map((u, i) => (
                  <Pressable key={u} onPress={() => setViewer({ photos, index: i })}>
                    <Image source={{ uri: u }} style={[styles.photo, { backgroundColor: c.surface2 }]} contentFit="cover" />
                    {i === 3 && photos.length > 4 && (
                      <View style={styles.more}>
                        <Text style={{ color: "#fff", fontWeight: "800" }}>+{photos.length - 4}</Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </Pressable>
    );
  };

  const renderPlace = (s: PlaceSummary) => {
    const ic = categoryIcon(s.category, s.name);
    return (
      <Pressable
        onPress={() => open(s.place)}
        disabled={!s.place}
        style={[styles.placeRow, { borderBottomColor: c.line }]}
        accessibilityRole="button"
      >
        <View style={[styles.icon, { backgroundColor: ic.color }]}>
          <MaterialCommunityIcons name={ic.glyph as never} size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: c.text }} numberOfLines={1}>
            {s.name} <Text style={{ fontSize: 12, fontWeight: "400", color: c.muted }}>{s.category.split(">").slice(-1)[0]?.trim()}</Text>
          </Text>
          <Text style={{ fontSize: 13, color: c.muted, marginTop: 3 }} numberOfLines={1}>
            {[s.visits ? `방문 ${s.visits}회` : null, s.total ? won(s.total) : null, s.lastAt ? `마지막 ${shortDate(s.lastAt)}` : null].filter(Boolean).join(" · ")}
          </Text>
          {(s.note?.rating || s.note?.memo || s.note?.photos?.length) ? (
            <Text style={{ fontSize: 13, color: c.text, marginTop: 3 }} numberOfLines={1}>
              {s.note?.rating ? <Text style={{ color: "#F5A400", fontWeight: "700" }}>{`★${s.note.rating} `}</Text> : null}
              {s.note?.photos?.length ? <Text style={{ color: c.muted }}>{`📷${s.note.photos.length} `}</Text> : null}
              {s.note?.memo ?? ""}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const header = (
    <View>
      {/* 이번 달 */}
      <View style={[styles.stats, { backgroundColor: c.surface, borderColor: c.line }]}>
        <Stat c={c} label="이번 달 외식" value={`${month.visits}회`} />
        <View style={[styles.statDiv, { backgroundColor: c.line }]} />
        <Stat c={c} label="쓴 돈" value={won(month.total)} />
        <View style={[styles.statDiv, { backgroundColor: c.line }]} />
        <Stat c={c} label="남긴 리뷰" value={`${month.reviews}개`} />
      </View>

      {access.supported && !access.enabled && (
        <Pressable onPress={openNotificationAccessSettings} style={[styles.banner, { backgroundColor: c.accentSoft }]} accessibilityRole="button">
          <Text style={{ color: c.text, fontSize: 13, lineHeight: 19 }}>
            <Text style={{ fontWeight: "800" }}>결제 알림 기록이 꺼져 있어요.</Text> 켜면 카드·페이 결제 알림으로 방문이 자동으로 남아요.
          </Text>
          <Text style={{ color: c.accent, fontWeight: "800", marginTop: 6 }}>알림 접근 켜기 ›</Text>
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 4, lineHeight: 17 }}>
            스위치가 회색이면: 설정 › 애플리케이션 › 근처맛집 › 오른쪽 위 ⋮ › "제한된 설정 허용" 후 다시 켜 주세요.
          </Text>
        </Pressable>
      )}
      {!access.supported && Platform.OS === "android" && (
        <Text style={[styles.banner, { backgroundColor: c.warnBg, color: c.warnText, fontSize: 13 }]}>이 설치 버전에는 결제 알림 읽기 기능이 없어요. 최신 APK로 업데이트해 주세요.</Text>
      )}

      {syncMsg && (
        <Pressable onPress={() => setSyncMsg(null)} style={[styles.banner, { backgroundColor: c.surface2 }]}>
          <Text style={{ color: c.text, fontSize: 13, lineHeight: 19 }}>{syncMsg}</Text>
        </Pressable>
      )}

      {/* 필터 */}
      <View style={styles.filters}>
        {(
          [
            ["all", "전체"],
            ["review", "리뷰"],
            ["pay", "결제"],
          ] as Array<[Filter, string]>
        ).map(([k, label]) => (
          <Pressable key={k} onPress={() => setFilter(k)} style={[styles.chip, { borderColor: filter === k ? c.text : c.line, backgroundColor: filter === k ? c.text : c.surface }]}>
            <Text style={{ color: filter === k ? c.bg : c.text, fontWeight: filter === k ? "700" : "400", fontSize: 13 }}>{label}</Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        {hiddenCount > 0 && filter !== "review" && (
          <Pressable onPress={() => setShowHidden((v) => !v)} hitSlop={6}>
            <Text style={{ color: c.muted, fontSize: 12 }}>{showHidden ? "숨긴 결제 감추기" : `숨긴 결제 ${hiddenCount}`}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  const empty = (
    <Text style={[styles.empty, { color: c.muted }]}>
      {filter === "review"
        ? "아직 남긴 평가가 없어요. 식당 상세에서 별점·메모·사진을 남겨 보세요."
        : "아직 기록이 없어요. 결제 알림 기록을 켜 두거나, 식당 상세에서 방문 기록을 추가해 보세요."}
    </Text>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "bottom"]}>
        <View style={[styles.top, { borderBottomColor: c.line }]}>
          <Text style={[styles.h1, { color: c.text }]}>내 타임라인</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            {access.supported && (
              <Pressable onPress={refresh} disabled={syncing} hitSlop={10} accessibilityLabel="결제 알림 다시 가져오기">
                {syncing ? <ActivityIndicator color={c.accent} /> : <MaterialCommunityIcons name="refresh" size={22} color={c.text} />}
              </Pressable>
            )}
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="닫기">
              <Text style={{ fontSize: 20, color: c.text }}>✕</Text>
            </Pressable>
          </View>
        </View>
        <View style={[styles.tabs, { borderBottomColor: c.line }]}>
          {(
            [
              ["time", "시간순"],
              ["place", "맛집별"],
            ] as Array<[Tab, string]>
          ).map(([k, label]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && { borderBottomColor: c.text }]} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
              <Text style={{ fontSize: 15, fontWeight: tab === k ? "800" : "500", color: tab === k ? c.text : c.muted }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {tab === "time" ? (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            ListHeaderComponent={header}
            ListEmptyComponent={empty}
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }) =>
              item.type === "day" ? (
                <View style={styles.dayRow}>
                  <Text style={{ fontSize: 14, fontWeight: "800", color: c.text }}>{item.label}</Text>
                  {item.total > 0 && <Text style={{ fontSize: 13, color: c.muted }}>{won(item.total)}</Text>}
                </View>
              ) : (
                renderCard(item.card)
              )
            }
          />
        ) : (
          <FlatList
            data={places}
            keyExtractor={(s) => s.key}
            ListHeaderComponent={header}
            ListEmptyComponent={empty}
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }) => renderPlace(item)}
          />
        )}
        <EditPayment record={fixing} colors={c} me={me} onClose={() => setFixing(null)} onDone={setSyncMsg} />
        <PhotoViewer photos={viewer?.photos ?? null} index={viewer?.index ?? 0} onClose={() => setViewer(null)} />
      </SafeAreaView>
    </Modal>
  );
}

function PayLine({ p, c, onEdit }: { p: PaymentRecord; c: Colors; onEdit?: () => void }) {
  return (
    <View style={styles.payLine}>
      <MaterialCommunityIcons name={p.manual ? "pencil-outline" : "credit-card-outline"} size={14} color={c.muted} />
      <Text style={{ fontSize: 13, color: p.canceled ? c.muted : c.text, textDecorationLine: p.canceled ? "line-through" : "none" }}>
        {p.manual ? "방문" : timeLabel(p.at)}
        {p.amount ? `  ${won(p.amount)}` : ""}
      </Text>
      <Text style={{ flex: 1, fontSize: 12, color: c.muted }} numberOfLines={1}>
        {p.sources.join(" · ")}
        {p.canceled ? " · 취소됨" : ""}
      </Text>
      {onEdit && !p.manual && (
        <Pressable onPress={onEdit} hitSlop={10} accessibilityRole="button" accessibilityLabel="결제 기록 장소 바꾸기">
          <Text style={{ fontSize: 12, color: c.muted, textDecorationLine: "underline" }}>장소 변경</Text>
        </Pressable>
      )}
    </View>
  );
}

function Stat({ c, label, value }: { c: Colors; label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={{ fontSize: 12, color: c.muted }}>{label}</Text>
      <Text style={{ fontSize: 16, fontWeight: "800", color: c.text, marginTop: 3 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const distText = (m: number | null) => (m == null ? "" : m < 1000 ? `${m}m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`);

/** 결제 기록 수정: 장소 바꾸기(후보·이름 검색), 숨기기, 삭제 */
function EditPayment({
  record,
  colors: c,
  me,
  onClose,
  onDone,
}: {
  record: PaymentRecord | null;
  colors: Colors;
  me: { lat: number; lng: number } | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [results, setResults] = useState<PlaceCandidate[] | null>(null);
  // 거리 기준: 결제 위치 → 내 위치
  const ref = record?.lat != null && record?.lng != null ? { lat: record.lat, lng: record.lng } : me;

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await searchPlacesByName(q.trim(), ref);
      setResults(r.places);
      if (!r.places.length) setMsg("찾는 가게가 없어요. 이름을 줄이거나 지점명을 빼 보세요.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "검색 실패");
    } finally {
      setBusy(false);
    }
  };

  const choose = async (place: PlaceSnap) => {
    if (!record) return;
    const others = await setPaymentPlace(record.id, snapOf(place));
    onClose();
    onDone(`'${place.name}'(으)로 바꿨어요.${others ? ` 같은 가맹점 결제 ${others}건도 같이 바꿨어요.` : ""} 다음 결제부터 이 가맹점은 이 장소로 기록돼요.`);
  };

  const candidates = (record?.candidates ?? []).filter((x) => x.id !== record?.place?.id);
  const Row = ({ p, d }: { p: PlaceSnap; d: number | null }) => (
    <Pressable onPress={() => choose(p)} style={[styles.pick, { borderTopColor: c.line }]} accessibilityRole="button">
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: c.text }} numberOfLines={1}>
          {p.name} <Text style={{ fontSize: 12, fontWeight: "400", color: c.muted }}>{p.category.split(">").slice(-1)[0]?.trim()}</Text>
        </Text>
        <Text style={{ fontSize: 12, color: c.muted, marginTop: 2 }} numberOfLines={1}>
          {p.roadAddress || p.address}
        </Text>
      </View>
      {d != null && <Text style={{ fontSize: 12, color: c.muted }}>{distText(d)}</Text>}
    </Pressable>
  );

  return (
    <Modal
      visible={!!record}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => {
        setQ(record?.merchant ?? record?.place?.name ?? "");
        setMsg(null);
        setResults(null);
      }}
    >
      <Pressable style={styles.dim} onPress={onClose}>
        <Pressable style={[styles.dialog, { backgroundColor: c.surface }]} onPress={() => {}}>
          <Text style={{ fontSize: 17, fontWeight: "800", color: c.text }}>결제 장소 바꾸기</Text>
          {record && (
            <Text style={{ fontSize: 12, color: c.muted, marginTop: 6, lineHeight: 18 }}>
              {shortDate(record.at)} {timeLabel(record.at)} · {won(record.amount)} · {record.sources.join(" · ")}
              {record.raw ? `\n알림: ${record.raw.replace(/\n/g, " ").slice(0, 90)}` : ""}
              {record.lat == null ? "\n결제 순간 위치가 없어 이름으로만 찾은 기록이에요." : ""}
            </Text>
          )}
          {record?.place && record.status === "matched" && (
            <Text style={{ fontSize: 13, color: c.text, marginTop: 10 }}>
              지금: <Text style={{ fontWeight: "700" }}>{record.place.name}</Text>{" "}
              <Text style={{ color: c.muted }}>{(record.place.roadAddress || record.place.address).split(" ").slice(0, 3).join(" ")}</Text>
            </Text>
          )}
          <ScrollView style={{ maxHeight: 340, marginTop: 8 }} keyboardShouldPersistTaps="handled">
            {!results && candidates.length > 0 && (
              <>
                <Text style={[styles.h3, { color: c.muted }]}>이름이 비슷한 다른 곳</Text>
                {candidates.map((p) => (
                  <Row key={p.id} p={p} d={p.distance} />
                ))}
              </>
            )}
            {results && (
              <>
                <Text style={[styles.h3, { color: c.muted }]}>검색 결과 {ref ? "(가까운 순)" : ""}</Text>
                {results.map((p) => (
                  <Row key={p.id} p={p} d={p.distance} />
                ))}
              </>
            )}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              onSubmitEditing={search}
              returnKeyType="search"
              placeholder="가게 이름으로 찾기"
              placeholderTextColor={c.muted}
              style={[styles.input, { flex: 1, minWidth: 0, marginTop: 0, color: c.text, borderColor: c.line, backgroundColor: c.bg }]}
            />
            <Pressable onPress={search} disabled={busy || !q.trim()} style={[styles.dBtn, { backgroundColor: c.accent, opacity: busy || !q.trim() ? 0.5 : 1, justifyContent: "center" }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800" }}>찾기</Text>}
            </Pressable>
          </View>
          {msg && <Text style={{ color: c.errorText, fontSize: 13, marginTop: 8 }}>{msg}</Text>}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 14 }}>
            {record && !record.hidden && (
              <Pressable
                onPress={() => {
                  updatePayment(record.id, { hidden: true });
                  onClose();
                }}
                hitSlop={6}
              >
                <Text style={{ color: c.muted, fontWeight: "700" }}>숨기기 (맛집 아님)</Text>
              </Pressable>
            )}
            {record && (
              <Pressable
                onPress={() =>
                  Platform.OS === "web"
                    ? (removePayment(record.id), onClose())
                    : Alert.alert("결제 기록 삭제", "이 결제 기록을 지울까요?", [
                        { text: "취소", style: "cancel" },
                        { text: "삭제", style: "destructive", onPress: () => (removePayment(record.id), onClose()) },
                      ])
                }
                hitSlop={6}
              >
                <Text style={{ color: c.errorText, fontWeight: "700" }}>삭제</Text>
              </Pressable>
            )}
            <Pressable onPress={onClose} hitSlop={6}>
              <Text style={{ color: c.text, fontWeight: "700" }}>닫기</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, height: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  h1: { fontSize: 20, fontWeight: "800" },
  tabs: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  stats: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginTop: 14, borderWidth: 1, borderRadius: 12, paddingVertical: 12 },
  statDiv: { width: StyleSheet.hairlineWidth, height: 28 },
  banner: { marginHorizontal: 16, marginTop: 10, borderRadius: 12, padding: 12, overflow: "hidden" },
  filters: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, marginTop: 14, marginBottom: 4 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  dayRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  card: { marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  payLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingLeft: 42 },
  cardActions: { flexDirection: "row", gap: 16, marginTop: 10, paddingLeft: 42 },
  photos: { flexDirection: "row", gap: 6, marginTop: 8 },
  photo: { width: 64, height: 64, borderRadius: 8 },
  more: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  placeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  empty: { textAlign: "center", fontSize: 14, lineHeight: 22, paddingVertical: 40, paddingHorizontal: 28 },
  dim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  dialog: { borderRadius: 14, padding: 18 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginTop: 14 },
  check: { borderRadius: 10, padding: 10, marginTop: 10, marginLeft: 42 },
  pick: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  h3: { fontSize: 12, fontWeight: "700", marginTop: 8, marginBottom: 2 },
  dBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, minWidth: 72, alignItems: "center" },
});
