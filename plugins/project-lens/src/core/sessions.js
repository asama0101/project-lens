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

/** 過ぎた予定は unconfirmed、実績は actual、それ以外は planned */
export function sessionKind(session, now) {
  if (session.kind === "actual") return "actual";
  return isPast(session, now) ? "unconfirmed" : "planned";
}

const nextId = (data) => {
  const max = allSessions(data).reduce((m, s) => Math.max(m, +(/^S(\d+)$/.exec(s.id)?.[1] ?? 0)), 0);
  return `S${max + 1}`;
};

/** 枠の置き場所の検証。他の枠との重なりは error、会議との重なりは warning */
function check(data, slot, ignoreId) {
  if (!isTime(slot.end)) return { error: `終了は ${toHHMM(LAST_END)} までにしてください` }; // 24:00 以降（開始 + 長さが日をまたぐ）
  const [s, e] = [toMin(slot.start), toMin(slot.end)];
  if (e <= s) return { error: "終了は開始より後にしてください" };
  if (e - s < MIN_LEN) return { error: `枠は${MIN_LEN}分以上にしてください` };
  // 休みの日に置けないのは、新しく置く・別の日から動かすとき。休みの日にすでにある枠は、同じ日の中なら直せる
  const stays = ignoreId && allSessions(data).some((x) => x.id === ignoreId && x.date === slot.date);
  if (!stays && offDayChecker(data.settings)(slot.date)) return { error: `${isWeekend(slot.date) && data.settings?.countWeekendsAndHolidays !== true ? "土日" : "休みの日"}には置けません（設定タブの「営業日として扱う日」に指定すると置けます）` };
  const other = allSessions(data).find((x) => x.id !== ignoreId && clash(x, slot));
  if (other) return { error: `他の枠（${other.start}〜${other.end}）と重なっています` };
  const mtg = data.events.find((m) => !m.skip && clash(m, slot));
  return mtg ? { warning: `会議「${mtg.title}」（${mtg.start}〜${mtg.end}）と重なっています` } : {};
}

const withTask = (data, taskId, fn) => ({ ...data, tasks: data.tasks.map((t) => (t.id === taskId ? fn(t) : t)) });
const mapSessions = (data, id, fn) => ({
  ...data,
  tasks: data.tasks.map((t) => ((t.sessions ?? []).some((s) => s.id === id) ? { ...t, sessions: t.sessions.map((s) => (s.id === id ? fn(s) : s)) } : t)),
});

const startsLater = (slot, now) => slot.date > now.date || (slot.date === now.date && slot.start > now.time);
/** 今日の実行中の枠（running: true）。前の日の running は、終了し忘れた印として扱わない */
const runningToday = (s, now) => s.running === true && s.kind === "actual" && !!now && s.date === now.date;
const RUNNING_FIXED = "実行中の枠は動かせません。「終了」を押してから直してください";
/** 動かしたら、前の日に残った running の印を外す（今日の実行中の枠は、そもそも動かせない） */
const dropRunning = (s) => { if (!("running" in s)) return s; const { running, ...rest } = s; void running; return rest; };

/** 新しい枠は、過去の時間に置いても予定（planned）。過ぎた予定は未確認として出て、確認（confirmSession）で実績になる */
export function addSession(data, taskId, slot) {
  if (!data.tasks.some((t) => t.id === taskId)) return { data, error: `タスク ${taskId} がありません` };
  const r = check(data, slot);
  if (r.error) return { data, error: r.error };
  const s = { id: nextId(data), date: slot.date, start: slot.start, end: slot.end, kind: "planned" };
  return { data: withTask(data, taskId, (t) => ({ ...t, sessions: [...(t.sessions ?? []), s] })), ...(r.warning && { warning: r.warning }) };
}

/** slot は { date, start }。長さは元のまま。種別は変えない（予定を過去へ動かしても未確認のまま） */
export function moveSession(data, sessionId, slot, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  if (runningToday(cur, now)) return { data, error: RUNNING_FIXED };
  const len = toMin(cur.end) - toMin(cur.start);
  const next = { date: slot.date, start: slot.start, end: toHHMM(toMin(slot.start) + len) };
  if (toMin(slot.start) + len > LAST_END) return { data, error: `終了は ${toHHMM(LAST_END)} までにしてください` };
  const r = check(data, next, sessionId);
  if (r.error) return { data, error: r.error };
  // 実績の枠は、開始が未来になったときだけ予定に戻す（終了が未来でも、始めた枠は実績のまま）
  const kind = cur.kind === "actual" && startsLater(next, now) ? "planned" : cur.kind;
  return { data: mapSessions(data, sessionId, (s) => dropRunning({ ...s, ...next, kind })), ...(r.warning && { warning: r.warning }) };
}

export function resizeSession(data, sessionId, end, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  if (runningToday(cur, now)) return { data, error: RUNNING_FIXED };
  const r = check(data, { date: cur.date, start: cur.start, end }, sessionId);
  if (r.error) return { data, error: r.error };
  const kind = cur.kind === "actual" && startsLater(cur, now) ? "planned" : cur.kind;
  return { data: mapSessions(data, sessionId, (s) => dropRunning({ ...s, end, kind })), ...(r.warning && { warning: r.warning }) };
}

export function confirmSession(data, sessionId, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  if (!isPast(cur, now)) return { data, error: "未来の枠は実績にできません" };
  return { data: mapSessions(data, sessionId, (s) => ({ ...s, kind: "actual" })) };
}

export function removeSession(data, sessionId) {
  return { ...data, tasks: data.tasks.map((t) => ((t.sessions ?? []).some((s) => s.id === sessionId) ? { ...t, sessions: t.sessions.filter((s) => s.id !== sessionId) } : t)) };
}

export function taskActual(data, taskId) {
  const ss = data.tasks.find((x) => x.id === taskId).sessions ?? [];
  const actual = ss.filter((s) => s.kind === "actual");
  const minutes = actual.reduce((sum, s) => sum + toMin(s.end) - toMin(s.start), 0);
  return { hours: minutes / 60, firstDate: actual.length ? actual.map((s) => s.date).sort()[0] : null, count: ss.length };
}

/**
 * 実行中の実績の枠（今日のタスクの「開始」で作り、「終了」で終える枠）: このタスクの、今日の日付の running: true の実績の枠（無ければ null）。
 * 保存した終了は仮の値（短い）で、実行中かどうかには使わない。前の日に残った running は、実行中にしない
 */
export function runningActual(data, taskId, now) {
  const t = data.tasks.find((x) => x.id === taskId);
  return (t?.sessions ?? []).filter((s) => runningToday(s, now)).at(-1) ?? null;
}

/** カレンダーに描く終了: 今日の実行中の枠は、保存した終了と、今を 15 分に切り上げた時刻の遅いほう（23:59 まで）。ほかは保存した終了 */
export function shownEnd(s, now) {
  if (!runningToday(s, now)) return s.end;
  return toHHMM(Math.max(toMin(s.end), Math.min(Math.ceil(toMin(now.time) / MIN_LEN) * MIN_LEN, LAST_END)));
}

/** 稼働に数える終了: 今日の実行中の枠は、保存した終了と今の遅いほう（終了し忘れても、今までしか数えない）。ほかは保存した終了 */
export const countedEnd = (s, now) => (runningToday(s, now) && now.time > s.end ? now.time : s.end);

/** 枠 [start, end) と重なる、ほかの枠・参加する会議の注意の文（無ければ undefined） */
function overlapWarning(data, slot, ignoreId) {
  const other = allSessions(data).find((x) => x.id !== ignoreId && clash(x, slot));
  if (other) return `他の枠（${other.start}〜${other.end}）と重なっています`;
  const mtg = data.events.find((m) => !m.skip && clash(m, slot));
  return mtg ? `会議「${mtg.title}」（${mtg.start}〜${mtg.end}）と重なっています` : undefined;
}

/**
 * 「開始」の枠を作る（状態は変えない。edit.js の startActual が使う）。今の時刻（23:58 より後は 23:58）から、running: true の実績の枠。
 * 仮の終了は 15 分後。ほかの枠・会議がそれより早く始まるなら、その開始まで（最短 1 分）。今の時刻にほかの枠・会議がある（同じ分に始まるを含む）ときは 1 分にして warning。
 * 後ろの予定では失敗しない。このタスクの予定の枠が今にかかる・15 分以内に始まるなら、その枠を実行中の実績にする（開始を今に）。
 * Error を返すのは、すでに実行中・休みの日・タスクが無いとき
 */
export function startRunning(data, taskId, now) {
  const t = data.tasks.find((x) => x.id === taskId);
  if (!t) return { data, error: `タスク ${taskId} がありません` };
  if (runningActual(data, taskId, now)) return { data, error: `${taskId} の実績は、すでに開始しています` };
  if (offDayChecker(data.settings)(now.date)) return { data, error: "休みの日には、実績を開始できません（設定タブの「営業日として扱う日」に指定すると開始できます）" };
  const st = Math.min(toMin(now.time), LAST_END - 1);
  const own = (t.sessions ?? []).find((s) => s.kind === "planned" && s.date === now.date && toMin(s.start) <= st + MIN_LEN && st < toMin(s.end));
  const busy = [...allSessions(data).filter((x) => x.id !== own?.id), ...data.events.filter((m) => !m.skip)].filter((x) => x.date === now.date);
  const now0 = busy.find((x) => toMin(x.start) <= st && st < toMin(x.end));
  const later = busy.map((x) => toMin(x.start)).filter((m) => m > st);
  const end = now0 ? st + 1 : Math.min(st + MIN_LEN, LAST_END, ...later);
  const slot = { date: now.date, start: toHHMM(st), end: toHHMM(end) };
  const id = own?.id ?? nextId(data);
  const s = { ...(own ?? { id }), ...slot, kind: "actual", running: true };
  const next = own ? mapSessions(data, id, () => s) : withTask(data, taskId, (x) => ({ ...x, sessions: [...(x.sessions ?? []), s] }));
  const warning = overlapWarning(data, slot, own?.id);
  return { data: next, sessionId: id, ...(warning && { warning }) };
}

/** 「終了」: 実行中の枠の終了を今（今が開始以前なら開始の 1 分後）にして、running を外す。重なりは warning だけ */
export function stopRunning(data, taskId, now) {
  const cur = runningActual(data, taskId, now);
  if (!cur) return { data, error: `${taskId} に、実行中の実績の枠がありません` };
  const end = now.time > cur.start ? now.time : toHHMM(toMin(cur.start) + 1);
  const warning = overlapWarning(data, { date: cur.date, start: cur.start, end }, cur.id);
  return { data: mapSessions(data, cur.id, (s) => dropRunning({ ...s, end })), start: cur.start, end, minutes: toMin(end) - toMin(cur.start), ...(warning && { warning }) };
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
