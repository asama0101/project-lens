// 作業枠（予定／実績）の規則。枠は「作業した時間の記録」で、タスクの状態は変えない。すべて不変更新。
import { toMin, toHHMM, isTime, isWeekend } from "./dates.js";
import { offDayChecker } from "./holidays.js";

const MIN_LEN = 15;
/** 枠の終了の上限（分）。時刻は HH:MM（00:00〜23:59）で持つので、24:00 は書けない */
export const LAST_END = 23 * 60 + 59;

/** 枠の持ち主（タスク）。list は data の配列の名前。無ければ null */
export function ownerOf(data, id) {
  const t = data.tasks.find((x) => x.id === id);
  return t ? { list: "tasks", item: t } : null;
}
/** タスクの全枠に taskId（持ち主の ID）・title・projectId を付けて平らに */
export const allSessions = (data) => data.tasks.flatMap((t) => (t.sessions ?? []).map((s) => ({ ...s, taskId: t.id, title: t.title, projectId: t.projectId })));
const findSession = (data, id) => allSessions(data).find((s) => s.id === id);
const clash = (a, b) => a.date === b.date && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
const isPast = (slot, now) => slot.date < now.date || (slot.date === now.date && slot.end <= now.time);

/** 枠の実績の区間。実績だけの枠は自身の時間、予定の枠は actual（無ければ undefined） */
const spanOf = (s) => (s.kind === "actual" ? s : s.kind === "planned" ? s.actual : undefined);
/** タスクの実績の区間（実績だけの枠と、予定の枠の actual）。実績の時間は、すべてこれで数える */
export const actualSpans = (data) => allSessions(data).flatMap((s) => {
  const a = spanOf(s);
  return a ? [{ sessionId: s.id, taskId: s.taskId, title: s.title, projectId: s.projectId, date: a.date, start: a.start, end: a.end }] : [];
});
/** 実績の区間の日付・開始・終了だけ。予定の未確認の判定に使う */
export const actualSlots = (data) => actualSpans(data).map(({ date, start, end }) => ({ date, start, end }));

/** 実績だけの枠と、actual を持つ予定の枠は actual。過ぎた予定は、重なる実績が無ければ unconfirmed、あれば planned。過ぎていない予定は planned */
export function sessionKind(session, now, actuals = []) {
  if (session.kind === "actual" || session.actual) return "actual";
  return isPast(session, now) && !actuals.some((a) => clash(a, session)) ? "unconfirmed" : "planned";
}

const nextId = (data) => {
  const max = allSessions(data).reduce((m, s) => Math.max(m, +(/^S(\d+)$/.exec(s.id)?.[1] ?? 0)), 0);
  return `S${max + 1}`;
};

/** 枠の置き場所の検証。予定は予定の枠と、実績は実績の区間（ignoreId の枠の分は除く）と重なると error。会議との重なりは warning。休みの日の error は予定だけ。word は重なりの文言 */
function check(data, slot, ignoreId, kind = "planned", word = kind === "actual" ? "実績の枠" : "枠") {
  if (!isTime(slot.end)) return { error: `終了は ${toHHMM(LAST_END)} までにしてください` }; // 24:00 以降（開始 + 長さが日をまたぐ）
  const [s, e] = [toMin(slot.start), toMin(slot.end)];
  if (e <= s) return { error: "終了は開始より後にしてください" };
  if (e - s < MIN_LEN) return { error: `枠は${MIN_LEN}分以上にしてください` };
  // 休みの日に置けないのは、新しく置く・別の日から動かすとき。休みの日にすでにある枠は、同じ日の中なら直せる
  const stays = ignoreId && allSessions(data).some((x) => x.id === ignoreId && x.date === slot.date);
  if (kind === "planned" && !stays && offDayChecker(data.settings)(slot.date)) return { error: `${isWeekend(slot.date) && data.settings?.countWeekendsAndHolidays !== true ? "土日" : "休みの日"}には置けません（設定タブの「営業日として扱う日」に指定すると置けます）` };
  const other = kind === "actual"
    ? actualSpans(data).find((x) => x.sessionId !== ignoreId && clash(x, slot))
    : allSessions(data).find((x) => x.id !== ignoreId && x.kind === "planned" && clash(x, slot));
  if (other) return { error: `他の${word}（${other.start}〜${other.end}）と重なっています` };
  const mtg = data.events.find((m) => !m.skip && clash(m, slot));
  return mtg ? { warning: `会議「${mtg.title}」（${mtg.start}〜${mtg.end}）と重なっています` } : {};
}

/** 枠の持ち主（タスク）ごとに fn を当てる */
const mapOwners = (data, fn) => ({ ...data, tasks: data.tasks.map(fn) });
const withOwner = (data, id, fn) => mapOwners(data, (t) => (t.id === id ? fn(t) : t));
const mapSessions = (data, id, fn) => mapOwners(data, (t) => ((t.sessions ?? []).some((s) => s.id === id) ? { ...t, sessions: t.sessions.map((s) => (s.id === id ? fn(s) : s)) } : t));

const startsLater = (slot, now) => slot.date > now.date || (slot.date === now.date && slot.start > now.time);

/** taskId はタスクの ID。新しい枠は、過去の時間に置いても予定（planned）。過ぎた予定は、重なる実績が無ければ未確認として出る */
export function addSession(data, taskId, slot) {
  if (!ownerOf(data, taskId)) return { data, error: `タスク ${taskId} がありません` };
  const r = check(data, slot);
  if (r.error) return { data, error: r.error };
  const s = { id: nextId(data), date: slot.date, start: slot.start, end: slot.end, kind: "planned" };
  return { data: withOwner(data, taskId, (t) => ({ ...t, sessions: [...(t.sessions ?? []), s] })), ...(r.warning && { warning: r.warning }) };
}

/** 実績の枠を足す。予定と重なってよい（実績どうしは不可）。休みの日にも置ける。開始が今より後は error */
export function addActual(data, taskId, slot, now) {
  if (!ownerOf(data, taskId)) return { data, error: `タスク ${taskId} がありません` };
  if (startsLater(slot, now)) return { data, error: "まだ始まっていない時間には実績を入れられません" };
  const r = check(data, slot, undefined, "actual");
  if (r.error) return { data, error: r.error };
  const s = { id: nextId(data), date: slot.date, start: slot.start, end: slot.end, kind: "actual" };
  return { data: withOwner(data, taskId, (t) => ({ ...t, sessions: [...(t.sessions ?? []), s] })), ...(r.warning && { warning: r.warning }) };
}

/** 予定の枠の実績（actual）を書く（あれば上書き）。ほかの実績の区間とは重ねられない。休みの日にも書ける。開始が今より後は error */
export function setActual(data, sessionId, slot, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  if (cur.kind === "actual") return { data, error: "この枠は実績だけの枠です" };
  if (startsLater(slot, now)) return { data, error: "まだ始まっていない時間には実績を入れられません" };
  const r = check(data, slot, sessionId, "actual", "実績");
  if (r.error) return { data, error: r.error };
  const actual = { date: slot.date, start: slot.start, end: slot.end };
  return { data: mapSessions(data, sessionId, (s) => ({ ...s, actual })), ...(r.warning && { warning: r.warning }) };
}

/** 予定の枠の actual だけを外す（予定の枠は残る） */
export function clearActual(data, sessionId) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  if (cur.kind === "actual") return { data, error: "この枠は実績だけの枠です" };
  if (!cur.actual) return { data, error: "この枠には実績がありません" };
  return { data: mapSessions(data, sessionId, ({ actual, ...s }) => s) };
}

/** slot は { date, start }。長さは元のまま。種別は変えない（予定を過去へ動かすと、重なる実績が無ければ未確認として出る）。実績は今より後へ動かせない */
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

export function removeSession(data, sessionId) {
  return mapOwners(data, (t) => ((t.sessions ?? []).some((s) => s.id === sessionId) ? { ...t, sessions: t.sessions.filter((s) => s.id !== sessionId) } : t));
}

/** タスクの実績の時間（実績の区間から）。count は枠の数 */
export function taskActual(data, taskId) {
  const ss = data.tasks.find((x) => x.id === taskId).sessions ?? [];
  const actual = ss.map(spanOf).filter(Boolean);
  const minutes = actual.reduce((sum, s) => sum + toMin(s.end) - toMin(s.start), 0);
  return { hours: minutes / 60, firstDate: actual.length ? actual.map((s) => s.date).sort()[0] : null, count: ss.length };
}

/** 進行中（開始済みで未終了）の予定枠の ID。タスクを完了にしても残す枠（futurePlanned に含めない） */
export function runningPlanned(data, taskId, now) {
  const t = data.tasks.find((x) => x.id === taskId);
  const started = (s) => s.date < now.date || (s.date === now.date && s.start <= now.time);
  return (t?.sessions ?? []).filter((s) => s.kind === "planned" && started(s) && !isPast(s, now)).map((s) => s.id);
}

/** まだ開始していない予定枠の ID（進行中の枠・終了した枠・実績・actual を持つ枠は含まない。完了にするとき解除する対象。進行中の枠は残り、終わったあとに実績にできる） */
export function futurePlanned(data, taskId, now) {
  const t = data.tasks.find((x) => x.id === taskId);
  const notStarted = (s) => s.date > now.date || (s.date === now.date && s.start > now.time);
  return (t?.sessions ?? []).filter((s) => s.kind === "planned" && !s.actual && notStarted(s)).map((s) => s.id);
}
