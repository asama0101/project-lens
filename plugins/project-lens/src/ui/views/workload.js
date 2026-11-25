// 「稼働」画面: 期間（日・週・月）ごとに、プロジェクト別のタスク（実績の作業枠）と会議（確認済み・参加するもの）の時間を見せる。プロジェクト別に、期間のタスクの完了と進捗（rangeTasks・progressByProject）も出し、末尾に期間のタスクの表を置く。
import { addDays } from "../../core/dates.js";
import { workload, periodRange } from "../../core/workload.js";
import { rangeTasks, progressByProject } from "../../core/week.js";
import { esc, fmtMD, wdJa } from "../common.js";

const h = (v) => `${v.toFixed(1)}h`;

/**
 * @param opts.period "day" | "week" | "month"
 * @param opts.date   表示する日（その日・その日を含む週・月）
 * @param opts.now    {date, time} 未確認の件数を数えるための現在時刻
 */
export function renderWorkload(data, today, opts = {}) {
  const { period = "day", date = today, now } = opts;
  const range = periodRange(period, date);
  const w = workload(data, range, now);
  const [y, m] = date.split("-").map(Number);
  const title = period === "day" ? `${date.replace(/-/g, "/")}(${wdJa(date)})` : period === "week" ? `${fmtMD(range.start)}〜${fmtMD(range.end)} の週` : `${y}年${m}月`;
  const todayLabel = { day: "今日", week: "今週" }[period] ?? "今月";
  const unTotal = w.unassigned.task + w.unassigned.meeting;
  const max = Math.max(0, ...w.rows.map((r) => r.total), unTotal);
  const bar = (task, meeting) => {
    const total = task + meeting;
    const width = max ? (total / max) * 100 : 0;
    const tp = total ? (task / total) * 100 : 0;
    return `<div class="wl-bar" style="width:${width.toFixed(1)}%"><i class="t" style="width:${tp.toFixed(1)}%"></i><i class="m" style="width:${(100 - tp).toFixed(1)}%"></i></div>`;
  };
  const ids = new Set(data.projects.map((p) => p.id));
  const taskRows = rangeTasks(data, range, today);
  const prog = progressByProject(taskRows);
  const unProg = { done: 0, total: 0 }; // プロジェクト未設定（null・存在しない）は、workload() の unassigned と同じく 1 行に寄せる
  for (const [id, p] of prog) if (!ids.has(id)) { unProg.done += p.done; unProg.total += p.total; }
  const sumProg = { done: taskRows.filter((r) => r.task.status === "Done").length, total: taskRows.length };
  const progCells = ({ done, total }) => total
    ? `<td class="num mono">${done} / ${total} 件</td><td><div class="wl-prog"><i style="width:${((done / total) * 100).toFixed(1)}%"></i></div></td>`
    : `<td class="num mono">—</td><td></td>`;
  const projName = (id) => data.projects.find((p) => p.id === id)?.name ?? "プロジェクトなし";
  const tasksTbl = taskRows.length
    ? `<div class="tscroll"><table class="tbl"><thead><tr><th>プロジェクト</th><th>タスク</th><th class="num">進捗</th><th class="num">予定</th><th class="num">実績</th></tr></thead><tbody>${taskRows.map((r) => `<tr><td>${esc(projName(r.task.projectId))}</td><td>${esc(r.task.title)}</td><td class="num mono">${r.checked ? `${r.checked.done}/${r.checked.total}` : "—"}</td><td class="num mono">${r.planned} 分</td><td class="num mono">${r.actual} 分</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="muted">この期間のタスクはありません。</p>`;
  const rows = w.rows.map((r) => `<tr><td>${esc(data.projects.find((p) => p.id === r.projectId)?.name ?? r.projectId)}</td><td class="num mono">${h(r.task)}</td><td class="num mono">${h(r.meeting)}</td><td class="num mono"><b>${h(r.total)}</b></td><td>${bar(r.task, r.meeting)}</td>${progCells(prog.get(r.projectId) ?? { done: 0, total: 0 })}</tr>`).join("");
  const un = unTotal > 0 || unProg.total > 0
    ? `<tr class="muted"><td>プロジェクト未設定</td><td class="num mono">${h(w.unassigned.task)}</td><td class="num mono">${h(w.unassigned.meeting)}</td><td class="num mono"><b>${h(unTotal)}</b></td><td>${bar(w.unassigned.task, w.unassigned.meeting).replace('class="wl-bar"', 'class="wl-bar un"')}</td>${progCells(unProg)}</tr>`
    : "";
  const sumTask = w.rows.reduce((a, r) => a + r.task, 0) + w.unassigned.task;
  const sumMtg = w.rows.reduce((a, r) => a + r.meeting, 0) + w.unassigned.meeting;
  const note = w.unconfirmed > 0
    ? `<div class="banner">未確認 ${w.unconfirmed}件（作業枠 ${w.unconfirmedTasks}・会議 ${w.unconfirmedMeetings}）は、まだ含まれていません。スケジュール画面で実績を入れると加わります。</div>`
    : "";
  const none = data.projects.length ? "" : `<p class="muted">プロジェクトがありません。ガントチャートかリストの「＋ プロジェクトを追加」から追加してください。</p>`;
  return `<section class="panel wl" aria-label="稼働">
    <div class="toolbar"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button class="btn" data-wnav="-1" aria-label="前へ">←</button><button class="btn" data-wnav="1" aria-label="次へ">→</button><button class="btn" data-wtoday>${todayLabel}</button><strong style="margin-left:6px">${title}</strong></div>
      <div class="seg" role="group" aria-label="期間"><button data-wperiod="day" aria-pressed="${period === "day"}">日</button><button data-wperiod="week" aria-pressed="${period === "week"}">週</button><button data-wperiod="month" aria-pressed="${period === "month"}">月</button></div></div>
    <div class="legend"><span><i class="sw wl-t"></i>タスク（実績の作業枠）</span><span><i class="sw wl-m"></i>会議（確認済み・参加するもの）</span></div>
    ${none}
    <div class="tscroll"><table class="tbl wl-tbl"><thead><tr><th>プロジェクト</th><th class="num">タスク</th><th class="num">会議</th><th class="num">合計</th><th>内訳</th><th class="num">完了</th><th>進捗</th></tr></thead><tbody>${rows}${un}</tbody>
      <tfoot><tr><td>合計</td><td class="num mono">${h(sumTask)}</td><td class="num mono">${h(sumMtg)}</td><td class="num mono">${h(w.total)}</td><td></td>${progCells(sumProg)}</tr></tfoot></table></div>
    ${note}
    <h2>タスク</h2>
    ${tasksTbl}
  </section>`;
}

/** 期間を 1 つ前後へ動かした日（日は 1 日、週は 7 日、月は 1 か月） */
export function shiftWorkloadDate(period, date, dir) {
  if (period === "day") return addDays(date, dir);
  if (period === "week") return addDays(date, 7 * dir);
  const [y, m] = date.split("-").map(Number);
  const t = y * 12 + (m - 1) + dir;
  return `${String(Math.floor(t / 12)).padStart(4, "0")}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}
