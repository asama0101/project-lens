// スケジュール画面（週／日）。位置と高さは 1 日（00:00〜24:00）に対する % で表し、カレンダーの高さは CSS で決める。
import { addDays, toMin, toHHMM, weekday } from "../../core/dates.js";
import { meetingKind, meetingActualSpan } from "../../core/schedule.js";
import { matchProject } from "../../core/rules.js";
import { offDayChecker } from "../../core/holidays.js";
import { sessionKind, allSessions, actualSlots, LAST_END } from "../../core/sessions.js";
import { isImportantMark, isClosed } from "../../core/schema.js";
import { esc, fmtMD, wdJa, STATUS_UI, dateInputHtml } from "../common.js";
import { renderSide, renderSideToggle, todayTaskIds } from "./prio.js";
import { statusCellHtml } from "./project.js";
import { renderTaskEditPanel } from "./taskpop.js";
import { taskFlags } from "../../core/metrics.js";

const SLOT_STEP = 15;
/** これより短い枠・会議（分）は、時刻と件名を 1 行に並べる（class short） */
const SHORT_MIN = 30;

/** 15 分刻みに丸め、その日（終了が 23:59 まで）に収める（開始の分を返す） */
export function snapStart(minutes, durationMin) {
  const last = Math.floor((LAST_END - durationMin) / SLOT_STEP) * SLOT_STEP;
  return Math.max(0, Math.min(Math.round(minutes / SLOT_STEP) * SLOT_STEP, last));
}

/** 選んだ枠と編集欄（タスク・詳細の開閉・削除の確認）の状態の鍵。選んでいなければ null */
export const selectionKey = (selSess, taskEdit) => (selSess ? `${selSess}|${taskEdit?.id ?? ""}|${taskEdit?.full ? 1 : 0}|${taskEdit?.askDel ? 1 : 0}` : null);
/**
 * 作業枠を選んだときの選択と編集欄（id が null・無い枠なら両方外す）。編集欄（タスクの編集）は、詳細を開いているか（full）を prev から引き継ぐ
 */
export function sessionSelection(data, id, prev) {
  const s = id ? allSessions(data).find((x) => x.id === id) : null;
  if (!s) return { selSess: null, taskEdit: null };
  return { selSess: id, taskEdit: { id: s.taskId, full: prev?.full ?? false, askDel: false } };
}
/** 選んだ枠を見える位置へ出すか: 選択か編集欄が、この描き直しで開いた・変わったときだけ（同じ選択のままの描き直しでは、ページを動かさない） */
export const revealSelection = (prevKey, key) => key != null && key !== prevKey;

export const weekStartOf = (d) => addDays(d, -((weekday(d) + 6) % 7));

/** 時間の軸（00:00〜24:00 の固定）→ 位置計算（すべて % ） */
export function calendarGeometry() {
  const h0 = 0, span = 24 * 60;
  const pc = (m) => ((m - h0) / span) * 100;
  return { h0, span, pc, tp: (m) => `${pc(m).toFixed(3)}%`, ht: (a, b) => `calc(${(pc(b) - pc(a)).toFixed(3)}% - 2px)` };
}

const hoursHtml = (g) => {
  let s = "";
  for (let h = Math.ceil(g.h0 / 60); h * 60 <= g.h0 + g.span; h++) s += `<div class="hour" style="top:${(((h * 60 - g.h0) / g.span) * 100).toFixed(3)}%"><span>${h}:00</span></div>`;
  return s;
};

function meetingBlocks(data, d, full, g, ctx) {
  return (data.events ?? []).filter((m) => m.date === d && (ctx.showSkipped || !m.skip || ctx.selMtg === m.id)).map((m) => {
    const a = Math.max(toMin(m.start), g.h0);
    const b = Math.min(toMin(m.end), g.h0 + g.span);
    if (b <= a) return "";
    const manual = m.source === "manual";
    const kind = meetingKind(m, ctx.now);
    const kc = kind === "actual" ? "act" : kind === "unconfirmed" ? "unconf" : "";
    const mark = m.skip ? " 不参加" : kind === "actual" ? " ✓" : kind === "unconfirmed" ? " 未確認" : "";
    const gap = m.actual && (m.actual.start !== m.start || m.actual.end !== m.end) ? ` 実績 ${m.actual.start}-${m.actual.end}` : ""; // 予定とずれた実績
    const pname = (data.projects ?? []).find((p) => p.id === m.projectId)?.name;
    const by = m.projectBy === "manual" ? "（手動）" : m.projectBy === "rule" ? "（規則）" : "";
    const proj = full ? `<span class="mp">${pname ? `プロジェクト: ${esc(pname)}${by}` : "プロジェクト未設定"}</span>` : "";
    return `<div class="blk mtg ${m.skip ? "skip" : ""} ${kc} ${ctx.selMtg === m.id ? "sel" : ""}${b - a < SHORT_MIN ? " short" : ""}" data-mtg="${esc(m.id)}" tabindex="0" ${manual ? `draggable="true" data-dragmtg="${esc(m.id)}"` : ""} style="top:${g.tp(a)};height:${g.ht(a, b)}" title="${esc(m.title)}${m.skip ? "(参加しない)" : ""}${manual ? "" : "(予定表から取得)"}${esc(gap)}"><span class="tm">${esc(m.start)}-${esc(m.end)}${esc(mark + gap)}</span>${esc(m.title)}${proj}${manual ? `<i class="rz" data-rzm="${esc(m.id)}" aria-label="終了時刻を変更"></i>` : ""}</div>`;
  }).join("");
}

const KIND_CLS = { actual: "act", unconfirmed: "unconf", planned: "plan" };
const KIND_JA = { act: "実績", unconf: "未確認", plan: "予定" };
/** 日表示の枠に出す、タスクの状態の文字 */
const STATUS_JA = { "To Do": "未着手", "In Progress": "着手中", Waiting: "待ち", Done: "完了", Cancelled: "中止" };

/** 2 つの枠（同じ日）の時間が重なるか */
const overlaps = (a, b) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

/**
 * その日の描く要素: 枠のブロック（予定の日付がその日）と、予定の枠の実績の帯（actual.date がその日。ドラッグ・サイズ変更なし）。
 * 実績の側（実績だけの枠・実績の帯）と予定の側の要素が重なるときは、予定を左半分・実績を右半分に並べる（重ならなければ全幅）
 */
function sessionBlocks(data, d, full, g, ctx) {
  const items = allSessions(data).flatMap((s) => [
    ...(s.date === d ? [{ s, t: s, bar: false, isAct: s.kind === "actual" }] : []),
    ...(s.kind === "planned" && s.actual?.date === d ? [{ s, t: s.actual, bar: true, isAct: true }] : []),
  ]);
  return items.map(({ s, t, bar, isAct }) => {
    const side = items.some((o) => o.isAct !== isAct && overlaps(o.t, t)) ? (isAct ? ";left:50%;width:50%" : ";left:0;width:50%") : "";
    const c = bar ? "act" : s.actual ? "plan" : KIND_CLS[sessionKind(s, ctx.now, ctx.actuals)]; // 実績を持つ予定のブロックは「予定」（未確認にしない）
    const task = data.tasks.find((x) => x.id === s.taskId);
    const st = full && task ? ` <span class="stt">${STATUS_JA[task.status] ?? ""}</span>` : "";
    const imp = task && isImportantMark(task) ? " imp" : ""; // 重要の印。完了したタスクには付けない（isImportantMark）
    const short = toMin(t.end) - toMin(t.start) < SHORT_MIN ? " short" : "";
    const attrs = bar ? `tabindex="0" data-actbar="${esc(s.id)}"` : `draggable="true" tabindex="0" data-dragsess="${esc(s.id)}"`;
    return `<div class="blk task ${c}${imp}${short} ${ctx.selSess === s.id ? "sel" : ""}" ${attrs} style="top:${g.tp(toMin(t.start))};height:${g.ht(toMin(t.start), toMin(t.end))}${side}" title="${esc(s.title)}(${KIND_JA[c]})"><span class="tm">${esc(t.start)}-${esc(t.end)}${c === "act" ? " ✓" : c === "unconf" ? " 未確認" : ""}</span><span class="ttl">${esc(s.title)}</span>${st}${bar ? "" : `<i class="rz" data-rz="${esc(s.id)}" aria-label="終了時刻を変更"></i>`}</div>`;
  }).join("");
}

/** 今日以外の日に開いたときの、突発タスクの開始の初期値 */
const URGENT_OTHER_DAY_START = "09:00";

/** 突発タスクの開始の初期値: 今日なら現在時刻を 15 分刻みに切り上げた時刻（23:45 まで）、ほかの日は 09:00 */
export function urgentDefaultStart(date, now) {
  if (date !== now.date) return URGENT_OTHER_DAY_START;
  return toHHMM(Math.min(Math.ceil(toMin(now.time) / SLOT_STEP) * SLOT_STEP, 24 * 60 - SLOT_STEP));
}

/** 突発タスクの入力欄の値 → addUrgentTask への入力。件名・日付・開始のどれかが空なら null（何も作らない） */
export function urgentInput(f) {
  const title = f.title.trim(), date = f.date.trim(), start = f.start.trim();
  if (!title || !date || !start) return null;
  return { input: { title, projectId: f.projectId || null, date, start, minutes: +f.minutes } };
}

/** 開始が今以前（今ちょうどを含む）か。実績を入れられるのは、始まった枠・会議だけ */
const started = (x, now) => x.date < now.date || (x.date === now.date && x.start <= now.time);

function meetingForm(data, ctx) {
  const draft = ctx.mtgDraft;
  const m = draft ?? (data.events ?? []).find((o) => o.id === ctx.selMtg);
  if (!m) return "";
  const isNew = !!draft;
  const lock = !isNew && m.source === "mcp" ? "disabled" : "";
  const projects = data.projects ?? [];
  const autoId = matchProject(m.title, (data.settings?.projectRules ?? []).filter((r) => projects.some((p) => p.id === r.projectId)));
  const autoName = projects.find((p) => p.id === autoId)?.name ?? "未設定";
  const cur = isNew ? (m.projectId ?? "") : m.projectBy === "manual" ? m.projectId : "";
  const projOpts = [`<option value=""${cur === "" ? " selected" : ""}>自動（規則）→ ${esc(autoName)}</option>`, ...projects.map((p) => `<option value="${esc(p.id)}"${cur === p.id ? " selected" : ""}>${esc(p.name)}</option>`)].join("");
  const span = !isNew && !m.skip && started(m, ctx.now) ? meetingActualSpan(m) : null; // 参加しない会議・始まっていない会議には、実績を入れない
  const act = span && (ctx.actDraft?.key === `m:${m.id}` ? { start: ctx.actDraft.start, end: ctx.actDraft.end } : span); // 入力中の下書きがあれば、その値で描く
  const actHtml = act ? `<label>実績の開始<input class="in" type="time" step="900" data-ma="start" value="${esc(act.start)}"></label>
    <label>実績の終了<input class="in" type="time" step="900" data-ma="end" value="${esc(act.end)}"></label>
    <div style="display:flex;gap:6px;align-items:center"><button class="btn" data-mtgact="${esc(m.id)}">実績を保存</button></div>` : "";
  return `<div class="mtgform" role="group" aria-label="会議の${isNew ? "追加" : "編集"}">
    <label>件名<input class="in" data-mt="title" value="${esc(m.title)}" placeholder="会議名" style="min-width:200px" ${lock}></label>
    <label>日付${dateInputHtml({ value: m.date, attrs: `data-mt="date" ${lock}`, label: "会議の日付" })}</label>
    <label>開始<input class="in" type="time" step="900" data-mt="start" value="${esc(m.start)}" ${lock}></label>
    <label>終了<input class="in" type="time" step="900" data-mt="end" value="${esc(m.end)}" ${lock}></label>
    <label>プロジェクト<select class="in" data-mt="projectId" aria-label="会議のプロジェクト">${projOpts}</select></label>
    <label class="chk"><input type="checkbox" data-mt="skip" ${m.skip ? "checked" : ""}>参加しない(稼働に数えず、作業枠と重なっても注意しない)</label>
    ${actHtml}<div style="display:flex;gap:6px;align-items:center">${isNew ? `<button class="btn" data-mtgsave>追加</button><button class="btn" data-mtgcancel>キャンセル</button>` : `${m.source === "manual" ? `<button class="btn danger" data-delsel>会議を削除</button>` : ""}<button class="btn" data-mtgclose>閉じる</button>`}</div>
    ${!isNew && m.source === "manual" ? `<p class="note" style="flex-basis:100%;margin:0">カレンダー上でドラッグして移動（別の日へも）、下端をドラッグして長さを変えられます。</p>` : ""}${!isNew && m.source === "mcp" ? `<p class="note" style="flex-basis:100%;margin:0">予定表から取得した会議です。件名と時間は取得内容が正のため変更できません。プロジェクトは、規則で自動に付き、ここで手動に変えられます。出席しない会議は「参加しない」にします（削除しても、次の取得で戻ります）。</p>` : ""}
  </div>`;
}

/** 突発タスクを登録する入力欄（件名・プロジェクト・長さ・日付・開始）。ヘッダーの「＋ 突発タスク」から開く。下書きがないときは出さない */
export function urgentForm(data, draft) {
  if (!draft) return "";
  const projOpts = [`<option value=""${draft.projectId === "" ? " selected" : ""}>プロジェクトなし</option>`, ...(data.projects ?? []).map((p) => `<option value="${esc(p.id)}"${draft.projectId === p.id ? " selected" : ""}>${esc(p.name)}</option>`)].join("");
  const minOpts = [15, 30, 45, 60].map((m) => `<option value="${m}"${draft.minutes === m ? " selected" : ""}>${m} 分</option>`).join("");
  return `<div class="mtgform urgform" role="group" aria-label="突発タスクの追加">
    <label>件名<input class="in" data-ug="title" value="${esc(draft.title)}" placeholder="突発タスクの件名" style="min-width:200px"></label>
    <label>プロジェクト<select class="in" data-ug="projectId" aria-label="突発タスクのプロジェクト">${projOpts}</select></label>
    <label>長さ<select class="in" data-ug="minutes" aria-label="突発タスクの長さ">${minOpts}</select></label>
    <label>日付${dateInputHtml({ value: draft.date, attrs: 'data-ug="date"', label: "突発タスクの日付" })}</label>
    <label>開始<input class="in" type="time" step="900" data-ug="start" value="${esc(draft.start)}"></label>
    <div style="display:flex;gap:6px;align-items:center"><button class="btn" data-urgsave>追加</button><button class="btn" data-urgcancel>キャンセル</button></div>
  </div>`;
}

/** 「実績を追加」の開始・終了の初期値: 今日は現在時刻を 15 分刻みに切り捨てた時刻から 60 分（23:59 まで。開始が今より後だと保存できない）、ほかの日は 09:00-10:00 */
export function actAddSpan(date, now) {
  if (date !== now.date) return ["09:00", "10:00"];
  const s = Math.floor(toMin(now.time) / SLOT_STEP) * SLOT_STEP;
  return [toHHMM(s), toHHMM(Math.min(s + 60, 24 * 60 - 1))];
}

/** 実績つきの予定の枠の削除の確認（opts.askDelSess が選択中の枠の id のとき）。N は、その枠の actual の分数 */
const delAsk = (s, askId) => s && s.actual && askId === s.id
  ? `<div class="ask" role="alert"><span class="note">実績 ${toMin(s.actual.end) - toMin(s.actual.start)} 分も消えます</span><button class="btn danger" data-delsessok="${esc(s.id)}">削除する</button><button class="btn" data-delsessno>やめる</button></div>` : "";

/**
 * 実績の入力欄。始まった予定の枠か、実績（actual）を持つ予定の枠を選んでいるときは、その枠の actual を書く欄（日付・開始・終了。持ち主は枠のタスク）。actual があれば「実績を更新」と「実績を消す」。
 * 「＋ 実績を追加」（ctx.add = { date }）のときは、タスク（Done・Cancelled 以外）・日付も選ぶ。どちらでもなければ出さない。
 * 入力の値は、保存を押したときに画面から読む（app.js）。入力中の値は下書き（ctx.draft = { key, task, date, start, end }。key は枠の ID・"add"）に残り、key が同じ欄は下書きの値で描く
 * @param ctx { selSess: 選択中の枠 ID, add: S.actAdd, draft: S.actDraft, today, now }
 */
export function actualForm(data, ctx) {
  const s = allSessions(data).find((x) => x.id === ctx.selSess);
  const fromPlan = s && s.kind === "planned" && (started(s, ctx.now) || !!s.actual);
  if (!fromPlan && !ctx.add) return "";
  const dr = ctx.draft?.key === (fromPlan ? s.id : "add") ? ctx.draft : null;
  const time = (k, v) => `<label>${k === "start" ? "開始" : "終了"}<input class="in" type="time" step="900" data-ac="${k}" value="${esc(dr?.[k] ?? v)}"></label>`;
  if (fromPlan) { // 初期値は、実績（actual）があればその値、なければ枠の日付と予定の時刻
    const a = s.actual ?? s;
    return `<div class="actform" role="group" aria-label="実績の入力">
    <span class="note" style="flex-basis:100%;margin:0">「${esc(s.title)}」の実績を${s.actual ? "更新します" : "入れます"}（予定の枠は残ります）</span>
    <label>日付${dateInputHtml({ value: dr?.date || a.date, attrs: 'data-ac="date"', label: "実績の日付" })}</label>
    ${time("start", a.start)}${time("end", a.end)}
    <div style="display:flex;gap:6px;align-items:center"><button class="btn" data-actsave="${esc(s.id)}">${s.actual ? "実績を更新" : "実績を保存"}</button>${s.actual ? `<button class="btn" data-actclear="${esc(s.id)}">実績を消す</button>` : ""}</div>
  </div>`;
  }
  const pn = (t) => (data.projects ?? []).find((p) => p.id === t.projectId)?.name;
  const taskOpts = data.tasks.filter((t) => !isClosed(t)).map((t) => `<option value="${esc(t.id)}"${dr?.task === t.id ? " selected" : ""}>${esc(pn(t) ? `${t.title}（${pn(t)}）` : t.title)}</option>`).join("");
  const date = dr?.date || (ctx.add.date ?? ctx.today);
  const [start, end] = actAddSpan(date, ctx.now);
  return `<div class="actform" role="group" aria-label="実績の入力">
    <label>タスク<select class="in" data-ac="task" aria-label="実績のタスク">${taskOpts}</select></label>
    <label>日付${dateInputHtml({ value: date, attrs: 'data-ac="date"', label: "実績の日付" })}</label>
    ${time("start", start)}${time("end", end)}
    <div style="display:flex;gap:6px;align-items:center"><button class="btn" data-actsave="">実績を保存</button><button class="btn" data-actcancel>キャンセル</button></div>
  </div>`;
}

/** 色の凡例（上の操作の行に置く）。日表示は現在時刻の線、参加しない会議を出すときはその印も */
const legendHtml = (day, showSkipped) => `<div class="slegend" aria-label="色の凡例"><span><i class="sw mtg"></i>会議</span>${showSkipped ? '<span><i class="sw skipsw"></i>参加しない会議</span>' : ""}<span><i class="sw mtgun"></i>未確認の会議</span><span><i class="sw plan"></i>予定</span><span><i class="sw act"></i>実績(✓)</span><span><i class="sw unconf"></i>未確認(過ぎた予定)</span>${day ? '<span><i class="sw now"></i>現在時刻</span>' : ""}<span><i class="sw sel"></i>選択中</span></div>`;

/** カレンダー部分（週または日）。会議の編集中はここだけを描き直す */
export function renderCalendar(data, today, opts) {
  const { view = "week", date = today } = opts;
  const ctx = { now: opts.now ?? { date: today, time: "00:00" }, selSess: opts.selSess ?? null, selMtg: opts.selMtg ?? null, showSkipped: opts.showSkipped === true, actuals: actualSlots(data) };
  const g = calendarGeometry();
  const isOff = offDayChecker(data.settings);
  let cal;
  if (view === "week") {
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStartOf(date), i));
    const heads = days.map((d) => `<button class="dh ${d === today ? "t" : ""}" data-day="${d}" aria-label="${fmtMD(d)}の1日表示">${fmtMD(d)}(${wdJa(d)})${isOff(d) ? '<small class="mono">—</small>' : ""}</button>`).join("");
    const cols = days.map((d) => `<div class="col dz ${d === today ? "today" : ""} ${isOff(d) ? "weekend" : ""}" data-date="${d}">${meetingBlocks(data, d, false, g, ctx)}${sessionBlocks(data, d, false, g, ctx)}</div>`).join("");
    const dueByDay = days.map((d) => data.tasks.filter((t) => t.due === d && t.status !== "Done" && t.status !== "Cancelled"));
    // 期限の行: 日付の見出しのすぐ下に固定する（theme.css）。閉じると、各日のセルの代わりに、週の件数の帯だけを出す
    const dueOpen = opts.showDue !== false;
    const dueToggle = `<div class="duehd"><button class="duetg" data-sdue aria-expanded="${dueOpen}" title="期限の行を${dueOpen ? "閉じます" : "開きます"}">期限 ${dueOpen ? "▾" : "▸"}</button></div>`;
    const dues = dueOpen
      ? dueByDay.map((due) => `<div class="duecell">${due.map((t) => `<div style="display:flex;gap:6px;align-items:baseline"><i class="dot ${STATUS_UI[t.status]?.dot ?? ""}${t.due < today ? " is-late" : ""}"></i><span${isImportantMark(t) ? ' class="impt"' : ""}>${esc(t.title)}</span></div>`).join("") || '<span class="muted">—</span>'}</div>`).join("")
      : `<div class="dueoff">この週の期限 ${dueByDay.flat().length} 件</div>`;
    cal = `<div class="cal wk"><div class="week"><div></div>${heads}${dueToggle}${dues}<div class="hrs">${hoursHtml(g)}</div>${cols}</div></div>
      <p class="note" style="margin:8px 0 0">日付を押すと1日表示に切り替わります。枠をクリックして選び、「枠を削除」か Delete キーで削除できます。</p>`;
  } else {
    const nowLine = date === ctx.now.date && toMin(ctx.now.time) >= g.h0 && toMin(ctx.now.time) <= g.h0 + g.span ? `<span class="nowline" style="top:${g.tp(toMin(ctx.now.time))}" title="現在 ${ctx.now.time}"></span>` : "";
    const offKinds = data.settings?.countWeekendsAndHolidays === true ? "休み" : "土日・日本の祝日・休み"; // 土日祝を営業日に数える設定のときは、手動の休みだけが休みの日
    const offNote = isOff(date) ? `<p class="note" style="margin:0 0 8px">この日は休みです（${offKinds}）。作業枠は置けません。設定タブの「営業日として扱う日」に指定すると置けます。</p>` : "";
    cal = `${offNote}<div class="cal"><div class="cal-grid">${hoursHtml(g)}<div class="cal-body dz" id="calbody" data-date="${date}">${meetingBlocks(data, date, true, g, ctx)}${sessionBlocks(data, date, true, g, ctx)}${nowLine}</div></div></div>`;
  }
  return cal;
}

/**
 * @param opts.view      "week" | "day"
 * @param opts.date      表示する日（週表示ではその日を含む週）
 * @param opts.now       {date, time}  現在時刻（過ぎた予定の判定に使う）
 * @param opts.selSess   選択中の枠 ID / opts.selMtg 選択中の会議 ID / opts.mtgDraft 追加中の会議の下書き / opts.urgentDraft 追加中の突発タスクの下書き / opts.taskEdit 編集欄を開いているタスク { id, full, askDel } / opts.actAdd 「実績を追加」の入力欄 { date } / opts.actDraft 実績の入力欄の下書き { key, task, date, start, end }
 * @param opts.showPrio  false なら今日の優先を出さない
 * @param opts.showSkipped  true なら「参加しない」の会議も出す（既定は出さない。選択中の会議だけは、隠さない）
 * @param opts.showDue   false なら週表示の期限の行を閉じる（既定は開く）
 */
export function renderSchedule(data, today, opts) {
  const { view = "week", date = today } = opts;
  const now = opts.now ?? { date: today, time: "00:00" };
  const step = view === "week" ? 7 : 1;
  const days = view === "week" ? [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStartOf(date), i)) : [date];
  const title = view === "week" ? `${fmtMD(days[0])}〜${fmtMD(days[6])} の週` : `${fmtMD(date)}(${wdJa(date)})`;
  const inView = allSessions(data).filter((s) => days.includes(s.date) || days.includes(s.actual?.date)); // 予定の日付か、実績の日付が範囲内
  const actuals = actualSlots(data);
  const kinds = inView.map((s) => sessionKind(s, now, actuals)); // 実績を持つ枠は actual なので、予定・未確認の件数に入らない
  const hours = actuals.filter((a) => days.includes(a.date)).reduce((a, s) => a + toMin(s.end) - toMin(s.start), 0) / 60;
  const planned = kinds.filter((k) => k === "planned").length;
  const unconfS = kinds.filter((k) => k === "unconfirmed").length;
  const unconfM = (data.events ?? []).filter((m) => days.includes(m.date) && meetingKind(m, now) === "unconfirmed").length;
  const unconf = unconfS + unconfM;
  const selSess = inView.find((s) => s.id === opts.selSess);
  const selMtg = (data.events ?? []).find((m) => m.id === opts.selMtg && days.includes(m.date));
  const delLabel = selSess ? `「${esc(selSess.title)}」の枠を削除` : selMtg && selMtg.source === "manual" ? `会議「${esc(selMtg.title)}」を削除` : "枠や会議を選んで削除";
  const delOk = !!selSess || (selMtg && selMtg.source === "manual");
  const calOpts = { ...opts, view, date, now, selSess: selSess?.id ?? null, selMtg: selMtg?.id ?? null };

  const nav = `<div class="toolbar"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button class="btn" data-nav="${-step}" aria-label="前へ">←</button><button class="btn" data-nav="${step}" aria-label="次へ">→</button><button class="btn" data-sgoto>今日</button><strong style="margin-left:6px">${title}</strong>${legendHtml(view === "day", opts.showSkipped === true)}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="chip-btn pref" data-sskip aria-pressed="${opts.showSkipped === true}" title="「参加しない」にした会議を、カレンダーに出したり隠したりします">参加しない会議</button><button class="btn" data-mtgadd>＋ 会議を追加</button><div class="seg" role="group" aria-label="表示"><button data-sview="week" aria-pressed="${view === "week"}">週</button><button data-sview="day" aria-pressed="${view === "day"}">日</button></div></div></div>
    <div class="summary"><span>実績 <b class="mono">${hours.toFixed(1)}時間</b></span><span>予定 <b class="mono">${planned}件</b></span>${unconf ? `<span class="pill wait">未確認 ${unconf}件（作業枠 ${unconfS}・会議 ${unconfM}）</span>` : ""}<button class="btn danger" data-delsel ${delOk ? "" : "disabled"}>${delLabel}</button></div>`;
  const et = selSess && opts.taskEdit ? data.tasks.find((t) => t.id === opts.taskEdit.id) : null; // 編集欄は、表示中の枠を選んでいる間だけ出す（枠を選ぶと、そのタスクの編集欄になる）
  const editPanel = et ? renderTaskEditPanel(data, opts.taskEdit, statusCellHtml(et, { ...opts, todayIds: opts.showPrio === false ? new Set() : new Set(todayTaskIds(data, today)) }, taskFlags(et, today, data.settings).includes("overdue"))) : "";
  return `<div class="cols${opts.showPrio === false ? " one" : ""}"><section class="panel"><div class="stop">${nav}</div><div id="mtgslot">${meetingForm(data, { mtgDraft: opts.mtgDraft, selMtg: selMtg?.id, actDraft: opts.actDraft, now })}${urgentForm(data, opts.urgentDraft)}${actualForm(data, { selSess: selSess?.id ?? null, add: opts.actAdd, draft: opts.actDraft, today, now })}${delAsk(selSess, opts.askDelSess)}${editPanel}</div><div id="calslot">${renderCalendar(data, today, calOpts)}</div></section>${renderSideToggle(opts.showPrio !== false)}${opts.showPrio === false ? "" : renderSide(data, today, { sched: true, pendingDone: opts.pendingDone, now })}</div>`;
}

