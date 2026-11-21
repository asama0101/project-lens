// 定例タスクの次の期限の算出。純関数。
// repeat: { unit: "week" } または { unit: "month", day: 1〜31 }
import { addDays, isDate } from "./dates.js";

/** repeat の形が正しいか */
export const isRepeat = (r) => (r?.unit === "week" || (r?.unit === "month" && Number.isInteger(r.day) && r.day >= 1 && r.day <= 31)) && (r.spawned == null || typeof r.spawned === "string");

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m は 1〜12

/**
 * 周期の日付のうち、期限 due と今日 today のどちらよりも後の最初の日。
 * 毎週は due から 7 日ずつ、毎月は due の月から順に、その月の day 日（月末を超えるときは月末）。
 * 早く完了しても周期はずれず、遅れて完了したら、過ぎた周期は飛ばす。
 */
export function nextRepeatDue(repeat, due, today) {
  if (!isDate(due) || !isDate(today)) throw new Error("日付の形式が不正です");
  if (repeat?.unit === "week") {
    let d = addDays(due, 7);
    while (d <= today) d = addDays(d, 7);
    return d;
  }
  if (isRepeat(repeat)) {
    let y = +due.slice(0, 4), m = +due.slice(5, 7);
    for (;;) {
      const d = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(repeat.day, daysIn(y, m))).padStart(2, "0")}`;
      if (d > due && d > today) return d;
      if (++m > 12) { m = 1; y++; }
    }
  }
  throw new Error("繰り返しの指定が不正です");
}
