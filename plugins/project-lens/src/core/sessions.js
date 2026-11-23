// 作業枠（予定／実績）の規則。枠は「作業した時間の記録」で、タスクの状態は変えない。すべて不変更新。
import { toMin, toHHMM, isTime, isWeekend } from "./dates.js";
import { offDayChecker } from "./holidays.js";

const MIN_LEN = 15;
/** 枠の終了の上限（分）。時刻は HH:MM（00:00〜23:59）で持つので、24:00 は書けない */
export const LAST_END = 23 * 60 + 59;

/** 全タスクの枠に taskId・title を付けて平らに */
export const allSessions = (data) => data.tasks.flatMap((t) => (t.sessions ?? []).map((s) => ({ ...s, taskId: t.id, title: t.title })));
const findSession = (data, id) => allSessions(data).find((s) => s.id === id);
const clash = (a, b) => a.date === b.date && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
const isPast = (slot, now) => slot.date < now.date || (slot.date === now.date && slot.end <= now.time);

/** 全タスクの実績の枠（日付・開始・終了）。予定の未確認の判定に使う */
export const actualSlots = (data) => allSessions(data).filter((s) => s.kind === "actual").map(({ date, start, end }) => ({ date, start, end }));

/** 実績は actual。過ぎた予定は、重なる実績が無ければ unconfirmed、あれば planned。過ぎていない予定は planned */
export function sessionKind(session, now, actuals = []) {
  if (session.kind === "actual") return "actual";
  return isPast(session, now) && !actuals.some((a) => clash(a, session)) ? "unconfirmed" : "planned";
}

const nextId = (data) => {
  const max = allSessions(data).reduce((m, s) => Math.max(m, +(/^S(\d+)$/.exec(s.id)?.[1] ?? 0)), 0);
  return `S${max + 1}`;
};

/** 枠の置き場所の検証。同じ種別（予定／実績）の枠との重なりは error、会議との重なりは warning。休みの日の error は予定だけ */
function check(data, slot, ignoreId, kind = "planned") {
  if (!isTime(slot.end)) return { error: `終了は ${toHHMM(LAST_END)} までにしてください` }; // 24:00 以降（開始 + 長さが日をまたぐ）
  const [s, e] = [toMin(slot.start), toMin(slot.end)];
  if (e <= s) return { error: "終了は開始より後にしてください" };
  if (e - s < MIN_LEN) return { error: `枠は${MIN_LEN}分以上にしてください` };
  // 休みの日に置けないのは、新しく置く・別の日から動かすとき。休みの日にすでにある枠は、同じ日の中なら直せる
  const stays = ignoreId && allSessions(data).some((x) => x.id === ignoreId && x.date === slot.date);
  if (kind === "planned" && !stays && offDayChecker(data.settings)(slot.date)) return { error: `${isWeekend(slot.date) && data.settings?.countWeekendsAndHolidays !== true ? "土日" : "休みの日"}には置けません（設定タブの「営業日として扱う日」に指定すると置けます）` };
  const other = allSessions(data).find((x) => x.id !== ignoreId && x.kind === kind && clash(x, slot));
  if (other) return { error: `他の${kind === "actual" ? "実績の" : ""}枠（${other.start}〜${other.end}）と重なっています` };
  const mtg = data.events.find((m) => !m.skip && clash(m, slot));
  return mtg ? { warning: `会議「${mtg.title}」（${mtg.start}〜${mtg.end}）と重なっています` } : {};
}

const withTask = (data, taskId, fn) => ({ ...data, tasks: data.tasks.map((t) => (t.id === taskId ? fn(t) : t)) });
const mapSessions = (data, id, fn) => ({
  ...data,
  tasks: data.tasks.map((t) => ((t.sessions ?? []).some((s) => s.id === id) ? { ...t, sessions: t.sessions.map((s) => (s.id === id ? fn(s) : s)) } : t)),
});

const startsLater = (slot, now) => slot.date > now.date || (slot.date === now.date && slot.start > now.time);

/** 新しい枠は、過去の時間に置いても予定（planned）。過ぎた予定は、重なる実績が無ければ未確認として出る */
export function addSession(data, taskId, slot) {
  if (!data.tasks.some((t) => t.id === taskId)) return { data, error: `タスク ${taskId} がありません` };
  const r = check(data, slot);
  if (r.error) return { data, error: r.error };
  const s = { id: nextId(data), date: slot.date, start: slot.start, end: slot.end, kind: "planned" };
  return { data: withTask(data, taskId, (t) => ({ ...t, sessions: [...(t.sessions ?? []), s] })), ...(r.warning && { warning: r.warning }) };
}

/** 実績の枠を足す。予定と重なってよい（実績どうしは不可）。休みの日にも置ける。開始が今より後は error */
export function addActual(data, taskId, slot, now) {
  if (!data.tasks.some((t) => t.id === taskId)) return { data, error: `タスク ${taskId} がありません` };
  if (startsLater(slot, now)) return { data, error: "まだ始まっていない時間には実績を入れられません" };
  const r = check(data, slot, undefined, "actual");
  if (r.error) return { data, error: r.error };
  const s = { id: nextId(data), date: slot.date, start: slot.start, end: slot.end, kind: "actual" };
  return { data: withTask(data, taskId, (t) => ({ ...t, sessions: [...(t.sessions ?? []), s] })), ...(r.warning && { warning: r.warning }) };
}

/** slot は { date, start }。長さは元のまま。種別は変えない（予定を過去へ動かしても未確認のまま）。実績は今より後へ動かせない */
export function moveSession(data, sessionId, slot, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  const len = toMin(cur.end) - toMin(cur.start);
  const next = { date: slot.date, start: slot.start, end: toHHMM(toMin(slot.start) + len) };
  if (toMin(slot.start) + len > LAST_END) return { data, error: `終了は ${toHHMM(LAST_END)} までにしてください` };
  if (cur.kind === "actual" && startsLater(next, now)) return { data, error: "実績は、今より後の時間には動かせません" };
  const r = check(data, next, sessionId, cur.kind);
  if (r.error) return { data, error: r.error };
  return { data: mapSessions(data, sessionId, (s) => ({ ...s, ...next })), ...(r.warning && { warning: r.warning }) };
}

/** 終了を変える。開始は変わらないので、種別（予定・実績）も変えない（now は使わない。呼び出し側との形をそろえて残す） */
export function resizeSession(data, sessionId, end, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  const r = check(data, { date: cur.date, start: cur.start, end }, sessionId, cur.kind);
  if (r.error) return { data, error: r.error };
  return { data: mapSessions(data, sessionId, (s) => ({ ...s, end })), ...(r.warning && { warning: r.warning }) };
}

/** 予定の枠を実績にする。今日のまだ終わっていない枠も実績にできる（今日のタスクの「実績にする」）。明日以降の枠は error */
export function confirmSession(data, sessionId, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  if (cur.date > now.date) return { data, error: "明日以降の枠は実績にできません" };
  // ほかの実績の枠と重なるなら、実績にしない（稼働に同じ時間を二重に数えないため）
  const other = allSessions(data).find((x) => x.id !== sessionId && x.kind === "actual" && clash(x, cur));
  if (other) return { data, error: `他の実績の枠（${other.start}〜${other.end}）と重なっています。どちらかの時間を直してから、実績にしてください` };
  return { data: mapSessions(data, sessionId, (s) => ({ ...s, kind: "actual" })) };
}

export function removeSession(data, sessionId) {
  return { ...data, tasks: data.tasks.map((t) => ((t.sessions ?? []).some((s) => s.id === sessionId) ? { ...t, sessions: t.sessions.filter((s) => s.id !== sessionId) } : t)) };
}

/** タスクの実績の時間 */
export function taskActual(data, taskId) {
  const ss = data.tasks.find((x) => x.id === taskId).sessions ?? [];
  const actual = ss.filter((s) => s.kind === "actual");
  const minutes = actual.reduce((sum, s) => sum + toMin(s.end) - toMin(s.start), 0);
  return { hours: minutes / 60, firstDate: actual.length ? actual.map((s) => s.date).sort()[0] : null, count: ss.length };
}

/** 進行中（開始済みで未終了）の予定枠の ID。タスクを完了にしても残す枠（futurePlanned に含めない） */
export function runningPlanned(data, taskId, now) {
  const t = data.tasks.find((x) => x.id === taskId);
  const started = (s) => s.date < now.date || (s.date === now.date && s.start <= now.time);
  return (t?.sessions ?? []).filter((s) => s.kind === "planned" && started(s) && !isPast(s, now)).map((s) => s.id);
}

/** まだ開始していない予定枠の ID（進行中の枠・終了した枠・実績は含まない。完了にするとき解除する対象。進行中の枠は残り、終わったあとに実績にできる） */
export function futurePlanned(data, taskId, now) {
  const t = data.tasks.find((x) => x.id === taskId);
  const notStarted = (s) => s.date > now.date || (s.date === now.date && s.start > now.time);
  return (t?.sessions ?? []).filter((s) => s.kind === "planned" && notStarted(s)).map((s) => s.id);
}
