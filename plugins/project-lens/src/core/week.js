// 週のタスクの一覧と見返しの計算。保存せず、タスクと枠から、その場で求める純関数。
// 週は weekStart（月曜）〜 weekStart + 6 日（日曜）。日付は文字列のまま比べる。
// - Cancelled は、どの週にも出さない。1 つのタスクは 1 行だけで、組の優先は overdue > scheduled > due > done。
// - overdue: 未完了で、期限が today より前。
// - scheduled: 未完了で、期限超過でなく、週の日付の予定の枠か実績の区間がある（期限は週より後でもよい）。
// - due: 未完了で、期限超過でも scheduled でもなく、期限が週の終わり以前。
// - done: Done で、doneAt が週の中、または週の日付の予定の枠か実績の区間がある。
// - waiting: 前のタスクのうち、data.tasks にあって、完了していないものが 1 つでもある。
// - planned: 自身の予定の枠（actual を持つ枠も数える）の、週の日付の分。actual: 自身の実績の区間の、週の日付の分。
// - 並び: 組の順、同じ組の中は期限の昇順（期限なしは最後）、同じなら ID の昇順。
// 今日の ToDo（todayTasks）は、週と別に、today の日付の枠と実績の区間から求める（規則は関数の説明）。
import { isClosed } from "./schema.js";
import { checklistCount } from "./checklist.js";
import { actualSpans } from "./sessions.js";
import { addDays, diffDays, isDate, toMin, weekday } from "./dates.js";

const ORDER = ["overdue", "scheduled", "due", "done"];

/** その日を含む週の月曜日 */
export const mondayOf = (date) => addDays(date, -((weekday(date) + 6) % 7));

const minutes = (x) => toMin(x.end) - toMin(x.start);

/** 今週の行（task・group・waiting・planned・actual・checked）。組の順・期限・ID の順 */
export const weekTasks = (data, weekStart, today) => rangeTasks(data, { start: weekStart, end: addDays(weekStart, 6) }, today);

/** 期間 { start, end }（両端を含む）の行。規則と並びは weekTasks と同じ（週を期間に読み替える。期限超過だけは today 基準） */
export function rangeTasks(data, range, today) {
  const inRange = (date) => date >= range.start && date <= range.end;
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const spans = actualSpans(data);
  const rows = [];
  for (const task of data.tasks) {
    if (task.status === "Cancelled") continue;
    const planned = (task.sessions ?? []).filter((s) => s.kind === "planned" && inRange(s.date));
    const actuals = spans.filter((a) => a.taskId === task.id && inRange(a.date));
    const touched = planned.length > 0 || actuals.length > 0;
    let group = null;
    if (task.status === "Done") {
      if ((task.doneAt && inRange(task.doneAt)) || touched) group = "done";
    } else if (task.due && task.due < today) group = "overdue";
    else if (touched) group = "scheduled";
    else if (task.due && task.due <= range.end) group = "due";
    if (!group) continue;
    const { total, done } = checklistCount(task);
    rows.push({
      task,
      group,
      waiting: (task.predecessors ?? []).some((id) => byId.has(id) && !isClosed(byId.get(id))),
      planned: planned.reduce((n, s) => n + minutes(s), 0),
      actual: actuals.reduce((n, a) => n + minutes(a), 0),
      checked: total ? { done, total } : null,
    });
  }
  const dueKey = (r) => r.task.due ?? "9999-99-99";
  return rows.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || dueKey(a).localeCompare(dueKey(b)) || a.task.id.localeCompare(b.task.id));
}

/** 行をプロジェクトごとに数える。Map<projectId|null, { done, total }>（Done の行が done） */
export function progressByProject(rows) {
  const m = new Map();
  for (const r of rows) {
    const key = r.task.projectId ?? null;
    const p = m.get(key) ?? { done: 0, total: 0 };
    p.total++;
    if (r.task.status === "Done") p.done++;
    m.set(key, p);
  }
  return m;
}

/** 今日の枠の、今日に見せる開始の時刻 */
const shownStart = (s, today) => (s.actual?.date === today ? s.actual.start : s.start);

/**
 * 今日の ToDo の行（task・slots・waiting・planned・actual・checked）。today の日付に、予定の枠か実績の区間があるタスク（Cancelled を除く）。
 * slots は今日の枠: 今日の予定の枠は予定の時刻と actual（別の日の実績でも付ける）。
 * 実績だけの枠と、予定の枠が別の日にあって actual だけが今日のものは、kind "actual" で実績の時刻。
 * slots の並びと、タスクの並びの鍵は、今日に見せる時刻（actual が今日なら actual の開始、ほかは枠の開始）の昇順。
 * planned・actual は今日の日付の分。並びは、未完了を今日の最初の枠の昇順（同じなら ID）、Done を末尾に
 */
export function todayTasks(data, today) {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const spans = actualSpans(data).filter((a) => a.date === today);
  const rows = [];
  for (const task of data.tasks) {
    if (task.status === "Cancelled") continue;
    const slots = [];
    for (const s of task.sessions ?? []) {
      if (s.kind === "planned" && s.date === today) slots.push({ id: s.id, date: today, start: s.start, end: s.end, kind: "planned", actual: s.actual });
      else if (s.kind === "actual" && s.date === today) slots.push({ id: s.id, date: today, start: s.start, end: s.end, kind: "actual", actual: undefined });
      else if (s.kind === "planned" && s.actual?.date === today) slots.push({ id: s.id, date: today, start: s.actual.start, end: s.actual.end, kind: "actual", actual: undefined });
    }
    if (!slots.length) continue;
    slots.sort((a, b) => shownStart(a, today).localeCompare(shownStart(b, today)));
    const { total, done } = checklistCount(task);
    rows.push({
      task,
      slots,
      waiting: (task.predecessors ?? []).some((id) => byId.has(id) && !isClosed(byId.get(id))),
      planned: slots.filter((s) => s.kind === "planned").reduce((n, s) => n + minutes(s), 0),
      actual: spans.filter((a) => a.taskId === task.id).reduce((n, a) => n + minutes(a), 0),
      checked: total ? { done, total } : null,
    });
  }
  const isDone = (r) => (r.task.status === "Done" ? 1 : 0);
  return rows.sort((a, b) => isDone(a) - isDone(b) || shownStart(a.slots[0], today).localeCompare(shownStart(b.slots[0], today)) || a.task.id.localeCompare(b.task.id));
}

/**
 * 催促の対象（task・party・since・expected・lapsedDays・waitedDays）。Waiting で、回答予定日が today より前、
 * または回答予定日が無く待ち始めから settings.waitingLongDays（既定 7）日以上のもの。待ち始めが無く予定日も無いものは入れない。
 * 並び: 予定日を過ぎた日数の多い順 → 予定日なしの待った日数の多い順（予定日ありの同点は ID）。不正な日付は無いものとして扱う
 */
export function chaseTasks(data, today) {
  const long = data.settings?.waitingLongDays ?? 7;
  const rows = [];
  for (const task of data.tasks) {
    const w = task.waitingOn;
    if (task.status !== "Waiting" || !w) continue;
    const expected = isDate(w.expected) ? w.expected : null; // 不正な日付は、無いものとして扱う
    const since = isDate(w.since) ? w.since : null;
    const lapsedDays = expected && expected < today ? diffDays(today, expected) : null;
    const waitedDays = since ? diffDays(today, since) : null;
    const due = lapsedDays != null || (!expected && waitedDays != null && waitedDays >= long);
    if (!due) continue;
    rows.push({ task, party: w.party ?? "", since, expected, lapsedDays, waitedDays });
  }
  return rows.sort((a, b) => (b.lapsedDays ?? -1) - (a.lapsedDays ?? -1) || (a.lapsedDays == null ? b.waitedDays - a.waitedDays : 0) || a.task.id.localeCompare(b.task.id));
}
