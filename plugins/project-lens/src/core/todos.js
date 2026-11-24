// ToDo（日・週）の規則。個人ファイルの data.todos / data.reviews を扱う。すべて純関数（入力を変えず、新しいデータを返す）。不正なときは例外
import { addDays, isDate, weekday, toMin } from "./dates.js";
import { offDayChecker } from "./holidays.js";
import { nextChecklistId } from "./checklist.js";
import { actualSlots, actualSpans, removeSession } from "./sessions.js";

const todosOf = (data) => data.todos ?? [];
const find = (data, id) => {
  const t = todosOf(data).find((x) => x.id === id);
  if (!t) throw new Error(`ToDo ${id} がありません`);
  return t;
};
const mapTodo = (data, id, fn) => ({ ...data, todos: todosOf(data).map((t) => (t.id === id ? fn(t) : t)) });
const cleanTitle = (title) => {
  const s = String(title ?? "").trim();
  if (!s) throw new Error("件名を入れてください");
  return s;
};
const checkDate = (date) => {
  if (!isDate(date)) throw new Error("日付は YYYY-MM-DD の形で入れてください");
  return date;
};

/** その日を含む週の月曜日 */
export const mondayOf = (date) => addDays(date, -((weekday(date) + 6) % 7));

/** 新しい ToDo を足す。週は date を月曜日にそろえる。parentId は週の ToDo だけを指せる（日の ToDo だけが持てる） */
export function addTodo(data, { scope, title, date, parentId }) {
  if (scope !== "week" && scope !== "day") throw new Error("種類は週か日にしてください");
  const t = cleanTitle(title);
  checkDate(date);
  if (parentId !== undefined && (scope !== "day" || todosOf(data).find((x) => x.id === parentId)?.scope !== "week")) throw new Error("割り当て元は週の ToDo にしてください");
  const max = todosOf(data).reduce((m, x) => Math.max(m, +(/^T-(\d+)$/.exec(x.id)?.[1] ?? 0)), 0);
  const id = `T-${String(max + 1).padStart(4, "0")}`;
  const todo = { id, scope, title: t, date: scope === "week" ? mondayOf(date) : date, ...(parentId !== undefined && { parentId }), doneAt: null, carried: 0, sessions: [] };
  return { data: { ...data, todos: [...todosOf(data), todo] }, id };
}

/** 週の ToDo の件名を直すと、直す前と同じ件名の子（日の ToDo）も新しい件名にする */
export function renameTodo(data, id, title) {
  const cur = find(data, id), t = cleanTitle(title);
  const follows = (x) => x.id === id || (cur.scope === "week" && x.parentId === id && x.title === cur.title);
  return { ...data, todos: todosOf(data).map((x) => (follows(x) ? { ...x, title: t } : x)) };
}

export const setTodoDone = (data, id, done, today) => (find(data, id), mapTodo(data, id, (t) => ({ ...t, doneAt: done ? today : null })));

/** ToDo を、その枠ごと消す。週の ToDo なら、子の parentId を外す（子とその枠は残る） */
export function deleteTodo(data, id) {
  find(data, id);
  return { ...data, todos: todosOf(data).filter((t) => t.id !== id).map(({ parentId, ...t }) => (parentId === id ? t : { ...t, ...(parentId !== undefined && { parentId }) })) };
}

/** 週の ToDo を日に割り当てる（同じ件名の日の ToDo を作る）。同じ週の ToDo の同じ日の分があれば何もしない */
export function assignToDay(data, weekTodoId, date) {
  const w = find(data, weekTodoId);
  if (w.scope !== "week") throw new Error("日へ割り当てられるのは週の ToDo だけです");
  checkDate(date);
  if (todosOf(data).some((t) => t.parentId === weekTodoId && t.date === date)) return { data, created: false };
  return { data: addTodo(data, { scope: "day", title: w.title, date, parentId: weekTodoId }).data, created: true };
}

const clash = (a, b) => a.date === b.date && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

/** 日は次の営業日へ、週は 7 日後へ動かし、carried を 1 増やす。回す前の日の予定の枠のうち、重なる実績が無いものは消す */
export function carryTodo(data, id) {
  const cur = find(data, id);
  if (cur.doneAt) throw new Error("完了した ToDo は回せません");
  let date = cur.date;
  if (cur.scope === "week") date = addDays(date, 7);
  else {
    const off = offDayChecker(data.settings);
    do date = addDays(date, 1); while (off(date));
  }
  const actuals = actualSlots(data);
  const stale = (cur.sessions ?? []).filter((s) => s.kind === "planned" && !s.actual && s.date === cur.date && !actuals.some((a) => clash(a, s)));
  const moved = mapTodo(data, id, (t) => ({ ...t, date, carried: t.carried + 1 }));
  return stale.reduce((d, s) => removeSession(d, s.id), moved);
}

export function addTodoCheck(data, id, text) {
  find(data, id);
  const s = String(text ?? "").trim();
  if (!s) throw new Error("項目の文言を入れてください");
  return mapTodo(data, id, (t) => ({ ...t, checklist: [...(t.checklist ?? []), { id: nextChecklistId(t.checklist ?? []), text: s, done: false }] }));
}
export const toggleTodoCheck = (data, id, itemId) => (find(data, id), mapTodo(data, id, (t) => ({ ...t, checklist: (t.checklist ?? []).map((x) => (x.id === itemId ? { ...x, done: !x.done } : x)) })));
export const removeTodoCheck = (data, id, itemId) => (find(data, id), mapTodo(data, id, (t) => ({ ...t, checklist: (t.checklist ?? []).filter((x) => x.id !== itemId) })));

/** 週（月曜日のキー）の気づき。空文字ならキーを消す */
export function setReview(data, weekStart, text) {
  const { [weekStart]: _, ...rest } = data.reviews ?? {};
  return { ...data, reviews: text ? { ...rest, [weekStart]: text } : rest };
}

/** 範囲内の分数。予定は kind が planned の枠の自身の時間（actual を持っていても数える。枠の日付で絞る）、実績は実績の区間（区間の日付で絞る） */
const minutesIn = (data, ids, range) => {
  const inRange = (d) => !range || (d >= range.start && d <= range.end);
  const len = (s) => toMin(s.end) - toMin(s.start);
  const planned = todosOf(data).filter((t) => ids.has(t.id)).flatMap((t) => t.sessions ?? []).filter((s) => s.kind === "planned" && inRange(s.date)).reduce((m, s) => m + len(s), 0);
  const actual = actualSpans({ tasks: [], todos: todosOf(data).filter((t) => ids.has(t.id)) }).filter((s) => inRange(s.date)).reduce((m, s) => m + len(s), 0);
  return { planned, actual };
};

/** その ToDo と、parentId がその ToDo の日の ToDo の枠の、range（start〜end の日付。省略は全期間）内の分の合計 */
export function todoMinutes(data, id, range) {
  return minutesIn(data, new Set(todosOf(data).filter((t) => t.id === id || t.parentId === id).map((t) => t.id)), range);
}

/** 週の見返し。見出しの分数は、その週の日付にある全 ToDo の枠の合計。行は、date がその週に入る週の ToDo と、parentId を持たない日の ToDo（inWeek: true。割り当てた日の分は親の行に含む）に、
 *  date は別の週でも自分か子の枠がその週にある、親のない ToDo（inWeek: false。回す前の週の分）を足す。完了・件数は inWeek: true の行だけ */
export function weekReview(data, weekStart) {
  const range = { start: weekStart, end: addDays(weekStart, 6) };
  const roots = todosOf(data).filter((t) => t.scope === "week" || t.parentId == null);
  const order = (a, b) => (a.scope === b.scope ? 0 : a.scope === "week" ? -1 : 1) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  const inWeek = (t) => t.date >= range.start && t.date <= range.end;
  const items = roots.filter(inWeek).sort(order);
  const row = (todo, w) => ({ todo, inWeek: w, checked: todo.checklist?.length ? { done: todo.checklist.filter((x) => x.done).length, total: todo.checklist.length } : null, ...todoMinutes(data, todo.id, range) });
  const rows = [...items.map((t) => row(t, true)), ...roots.filter((t) => !inWeek(t)).sort(order).map((t) => row(t, false)).filter((r) => r.planned + r.actual > 0)];
  const all = minutesIn(data, new Set(todosOf(data).map((t) => t.id)), range);
  return {
    done: items.filter((t) => t.doneAt).length,
    total: items.length,
    ...all,
    note: data.reviews?.[weekStart] ?? "",
    rows,
  };
}
