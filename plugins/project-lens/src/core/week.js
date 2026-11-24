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
