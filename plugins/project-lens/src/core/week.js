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
import { addDays, toMin, weekday } from "./dates.js";

const ORDER = ["overdue", "scheduled", "due", "done"];

/** その日を含む週の月曜日 */
export const mondayOf = (date) => addDays(date, -((weekday(date) + 6) % 7));

/** 週（月曜日のキー）の気づき。空文字ならキーを消す */
export function setReview(data, weekStart, text) {
  const { [weekStart]: _, ...rest } = data.reviews ?? {};
  return { ...data, reviews: text ? { ...rest, [weekStart]: text } : rest };
}
const minutes = (x) => toMin(x.end) - toMin(x.start);

/** 今週の行（task・group・waiting・planned・actual・checked）。組の順・期限・ID の順 */
export function weekTasks(data, weekStart, today) {
  const weekEnd = addDays(weekStart, 6);
  const inWeek = (date) => date >= weekStart && date <= weekEnd;
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const spans = actualSpans(data);
  const rows = [];
  for (const task of data.tasks) {
    if (task.status === "Cancelled") continue;
    const planned = (task.sessions ?? []).filter((s) => s.kind === "planned" && inWeek(s.date));
    const actuals = spans.filter((a) => a.taskId === task.id && inWeek(a.date));
    const touched = planned.length > 0 || actuals.length > 0;
    let group = null;
    if (task.status === "Done") {
      if ((task.doneAt && inWeek(task.doneAt)) || touched) group = "done";
    } else if (task.due && task.due < today) group = "overdue";
    else if (touched) group = "scheduled";
    else if (task.due && task.due <= weekEnd) group = "due";
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

/** 週の見返し。done はそのうち Done の数、planned・actual は行の合計、note は reviews の気づき */
export function weekSummary(data, weekStart, today) {
  const rows = weekTasks(data, weekStart, today);
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  return {
    done: rows.filter((r) => r.task.status === "Done").length,
    total: rows.length,
    planned: sum("planned"),
    actual: sum("actual"),
    note: data.reviews?.[weekStart] ?? "",
    rows,
  };
}
