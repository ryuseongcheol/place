import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Image } from "expo-image";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { openNotificationAccessSettings } from "../modules/payment-notifications";
import { dayKey, dayLabel, monthStart, shortDate, timeLabel, won } from "./dates";
import { useFavorites } from "./favorites";
import { useMyNotes, type MyNote } from "./myNotes";
import { usePaymentAccess } from "./paymentAccess";
import { rematchPayment, removePayment, syncPayments, updatePayment, usePayments, type PaymentRecord } from "./payments";
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
      await syncPayments({ fallbackLoc: me, force: true });
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
              <Text style={{ color: c.accent, fontSize: 13, fontWeight: "700" }}>가게 이름 고치기</Text>
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
            <PayLine key={p.id} p={p} c={c} />
          ))}
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
        <FixMerchant record={fixing} colors={c} onClose={() => setFixing(null)} />
        <PhotoViewer photos={viewer?.photos ?? null} index={viewer?.index ?? 0} onClose={() => setViewer(null)} />
      </SafeAreaView>
    </Modal>
  );
}

function PayLine({ p, c }: { p: PaymentRecord; c: Colors }) {
  return (
    <View style={styles.payLine}>
      <MaterialCommunityIcons name={p.manual ? "pencil-outline" : "credit-card-outline"} size={14} color={c.muted} />
      <Text style={{ fontSize: 13, color: p.canceled ? c.muted : c.text, textDecorationLine: p.canceled ? "line-through" : "none" }}>
        {p.manual ? "방문" : timeLabel(p.at)}
        {p.amount ? `  ${won(p.amount)}` : ""}
      </Text>
      <Text style={{ fontSize: 12, color: c.muted }} numberOfLines={1}>
        {p.sources.join(" · ")}
        {p.canceled ? " · 취소됨" : ""}
      </Text>
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

/** 가맹점 이름 고쳐서 다시 찾기 */
function FixMerchant({ record, colors: c, onClose }: { record: PaymentRecord | null; colors: Colors; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Modal visible={!!record} transparent animationType="fade" onRequestClose={onClose} onShow={() => (setName(record?.merchant ?? ""), setMsg(null))}>
      <Pressable style={styles.dim} onPress={onClose}>
        <Pressable style={[styles.dialog, { backgroundColor: c.surface }]} onPress={() => {}}>
          <Text style={{ fontSize: 17, fontWeight: "800", color: c.text }}>가게 이름 고치기</Text>
          {record && (
            <Text style={{ fontSize: 13, color: c.muted, marginTop: 6, lineHeight: 19 }}>
              {shortDate(record.at)} {timeLabel(record.at)} · {won(record.amount)} · {record.sources.join(" · ")}
              {record.raw ? `\n알림: ${record.raw.replace(/\n/g, " ").slice(0, 90)}` : ""}
            </Text>
          )}
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="예: 진국집 역삼점"
            placeholderTextColor={c.muted}
            autoFocus
            style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.bg }]}
          />
          {msg && <Text style={{ color: c.errorText, fontSize: 13, marginTop: 8 }}>{msg}</Text>}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
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
                style={[styles.dBtn, { backgroundColor: c.surface2 }]}
              >
                <Text style={{ color: c.errorText, fontWeight: "700" }}>삭제</Text>
              </Pressable>
            )}
            <Pressable
              disabled={busy || !name.trim()}
              onPress={async () => {
                if (!record) return;
                setBusy(true);
                setMsg(null);
                try {
                  await rematchPayment(record.id, name);
                  onClose();
                } catch (e) {
                  setMsg(e instanceof Error ? e.message : "찾지 못했어요");
                } finally {
                  setBusy(false);
                }
              }}
              style={[styles.dBtn, { backgroundColor: c.accent, opacity: busy || !name.trim() ? 0.5 : 1 }]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800" }}>다시 찾기</Text>}
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
  dBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, minWidth: 72, alignItems: "center" },
});
