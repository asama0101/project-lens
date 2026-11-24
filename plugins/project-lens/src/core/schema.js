// data.json の検証。errors は保存してはいけない不整合、warnings は保存を止めない注意。
import { isDate, isTime, toMin, nowLocal, diffDays, weekday } from "./dates.js";
import { isRepeat } from "./repeat.js";

export const TASK_STATUS = ["To Do", "In Progress", "Waiting", "Done", "Cancelled"];
export const PROJECT_STATUS = ["計画中", "進行中", "保留", "完了", "中止"];
export const PROJECT_TYPE = ["増設", "更改", "改善", "不具合対処", "その他"];
export const CAUSES = ["ベンダー", "社内", "自分", "その他"];
export const HOLIDAY_KINDS = ["祝日", "有給", "その他"];
/** 期限が今日からこれ以上（日）離れていたら、年の打ち間違いとして注意に出す */
const FAR_DAYS = 3650;
const REQUEST_STATUS = ["pending", "working", "question", "proposed", "applied", "rejected", "failed"];
export const OP_KINDS = ["moveDue", "addPred", "removePred", "addTask", "addProject", "setStatus", "setImportance", "updateProject", "removeTask", "removeProject", "addMilestone", "moveMilestone", "removeMilestone", "addChecklistItem", "setChecklistDone", "setChecklistText", "removeChecklistItem"];
/** 新しい依頼（提案・承認）で受ける操作。OP_KINDS は、保存済みの proposal.ops の検証用に残す */
export const PROPOSE_OPS = ["addTask", "moveDue"];

/** 終わったタスク（Done・Cancelled）か */
export const isClosed = (t) => t.status === "Done" || t.status === "Cancelled";

/** 重要の印を出すタスクか（重要で、終わっていない） */
export const isImportantMark = (t) => t.important === true && !isClosed(t);

/** 同じ日の枠が重なるか（端が接するだけは重ならない） */
const overlap = (a, b) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

/** 前のタスクの循環を DFS で探す。循環に含まれるタスク ID の一覧を返す */
function findCycle(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map(); // 1=探索中, 2=完了
  const stack = [];
  let found = null;
  const dfs = (id) => {
    if (found) return;
    state.set(id, 1);
    stack.push(id);
    for (const p of byId.get(id)?.predecessors ?? []) {
      if (!byId.has(p)) continue;
      if (state.get(p) === 1) { found = [...stack.slice(stack.indexOf(p)), p]; return; }
      if (!state.has(p)) dfs(p);
      if (found) return;
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const t of tasks) if (!state.has(t.id)) dfs(t.id);
  return found;
}

/**
 * @param {object} data
 * @param {{date:string,time:string}} [now] 「未来の予定枠」の判定に使う現在時刻
 */
export function validate(data, now = nowLocal()) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!data || typeof data !== "object") return { errors: ["データがオブジェクトではありません"], warnings };
  for (const k of ["projects", "tasks", "events", "changeLog"]) {
    if (!Array.isArray(data[k])) err(`${k} が配列ではありません`);
  }
  if (errors.length) return { errors, warnings };

  // 要素の形（オブジェクトか。配列にすべき項目が配列か）。崩れていると、以降の検査が例外で落ちて診断が出ないため、ここで止める
  const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  for (const k of ["projects", "tasks", "events", "changeLog"]) data[k].forEach((x, i) => { if (!isObj(x)) err(`${k}[${i}] がオブジェクトではありません`); });
  const arrayProps = (k, props) => data[k].forEach((x, i) => {
    if (!isObj(x)) return;
    for (const p of props) {
      if (x[p] == null) continue;
      if (!Array.isArray(x[p])) err(`${k}[${i}].${p} が配列ではありません`);
      else x[p].forEach((y, j) => { if (p !== "predecessors" && !isObj(y)) err(`${k}[${i}].${p}[${j}] がオブジェクトではありません`); });
    }
  });
  arrayProps("projects", ["milestones"]);
  arrayProps("tasks", ["predecessors", "sessions"]);
  if (data.settings?.projectRules != null && !Array.isArray(data.settings.projectRules)) err("settings.projectRules が配列ではありません");
  if (errors.length) return { errors, warnings };

  const dup = (list, label) => {
    const seen = new Set();
    for (const x of list) {
      if (seen.has(x.id)) err(`${label} の ID が重複しています: ${x.id}`);
      seen.add(x.id);
    }
  };
  const todos = data.todos ?? []; // 個人ファイルの ToDo。無いデータもある
  dup(data.projects, "プロジェクト");
  dup(data.tasks, "タスク");
  dup(data.events, "会議");
  dup(todos, "ToDo");
  // 作業枠の ID は、移動・削除が ID だけで探すので、重複すると両方に効く。保存は止めず、注意に出す
  // 共有ファイルに無いタスクの作業枠（orphanSessions）も、同じ個人ファイルの枠なので含める
  const sessionIds = new Set();
  for (const s of [...data.tasks.flatMap((t) => t.sessions ?? []), ...todos.flatMap((t) => t.sessions ?? []), ...(data.orphanSessions ?? [])]) {
    if (sessionIds.has(s.id)) warn(`作業枠の ID が重複しています: ${s.id}（移動・削除が両方に効きます。data.json から直接直してください）`);
    sessionIds.add(s.id);
  }

  const projectIds = new Set(data.projects.map((p) => p.id));
  const taskIds = new Set(data.tasks.map((t) => t.id));

  for (const p of data.projects) {
    if (!PROJECT_STATUS.includes(p.status)) err(`プロジェクト ${p.id}: 不明な状態 "${p.status}"`);
    if (!isDate(p.start)) err(`プロジェクト ${p.id}: 開始日の形式が不正です (${p.start})`);
    if (!isDate(p.due)) err(`プロジェクト ${p.id}: 期限の形式が不正です (${p.due})`);
    else if (Math.abs(diffDays(p.due, now.date)) > FAR_DAYS) warn(`プロジェクト ${p.id}: 期限 ${p.due} が今日から 10 年以上離れています（年の打ち間違いではありませんか。ガントが極端に広くなります）`);
    if (isDate(p.start) && isDate(p.due) && p.start > p.due) err(`プロジェクト ${p.id}: 開始日が期限より後です`);
    for (const m of p.milestones ?? []) {
      if (!isDate(m.date)) err(`プロジェクト ${p.id}: マイルストーン "${m.name}" の日付が不正です`);
    }
  }

  // チェックリストの形（タスクと ToDo で共通）
  const checkChecklist = (t, who) => {
    if (t.checklist === undefined) return;
    if (!Array.isArray(t.checklist)) { err(`${who}: チェックリスト (checklist) が配列ではありません`); return; }
    const seen = new Set();
    for (const c of t.checklist) {
      if (typeof c?.id !== "string" || !c.id) err(`${who}: チェックリストの項目の ID が文字列ではありません`);
      else if (seen.has(c.id)) err(`${who}: チェックリストの項目の ID が重複しています: ${c.id}`);
      else seen.add(c.id);
      if (typeof c?.text !== "string" || !c.text.trim()) err(`${who}: チェックリストの項目 ${c?.id} の文言が空です`);
      if (typeof c?.done !== "boolean") err(`${who}: チェックリストの項目 ${c?.id} の done が真偽値ではありません`);
    }
  };
  // 作業枠の形（タスクと ToDo で共通）。まだ始まっていない枠か（形が不正なら false）を返す
  const checkSession = (s, label) => {
    if (!isDate(s.date) || !isTime(s.start) || !isTime(s.end)) { err(`${label}: 日付または時刻の形式が不正です`); return false; }
    if (toMin(s.end) <= toMin(s.start)) err(`${label}: 終了が開始以前です`);
    if (!["planned", "actual"].includes(s.kind)) err(`${label}: 不明な kind "${s.kind}"`);
    const a = s.actual;
    if (a != null) {
      if (s.kind === "actual") err(`${label}: 実績だけの枠 (kind: "actual") は actual を持てません`);
      else if (!isObj(a) || !isDate(a.date) || !isTime(a.start) || !isTime(a.end)) err(`${label}: actual の日付または時刻の形式が不正です`);
      else if (toMin(a.end) <= toMin(a.start)) err(`${label}: actual の終了が開始以前です`);
    }
    return s.date > now.date || (s.date === now.date && s.start > now.time); // 進行中の枠は、完了にしても残す（futurePlanned）
  };

  for (const t of data.tasks) {
    if (!TASK_STATUS.includes(t.status)) err(`タスク ${t.id}: 不明な状態 "${t.status}"`);
    if (t.projectId !== null && !projectIds.has(t.projectId)) err(`タスク ${t.id}: 不明な projectId "${t.projectId}"`);
    if (!isDate(t.due)) err(`タスク ${t.id}: 期限の形式が不正です (${t.due})`);
    else if (Math.abs(diffDays(t.due, now.date)) > FAR_DAYS) warn(`タスク ${t.id}: 期限 ${t.due} が今日から 10 年以上離れています（年の打ち間違いではありませんか。ガントが極端に広くなります）`);
    if (t.start != null && !isDate(t.start)) err(`タスク ${t.id}: 開始日の形式が不正です (${t.start})`);
    if (t.doneAt != null && !isDate(t.doneAt)) err(`タスク ${t.id}: 完了日の形式が不正です (${t.doneAt})`);
    if (t.repeat != null && !isRepeat(t.repeat)) err(`タスク ${t.id}: 繰り返し (repeat) は、{ unit: "week" } か { unit: "month", day: 1〜31 } にしてください`);
    if (t.important !== undefined && t.important !== true) err(`タスク ${t.id}: 重要 (important) は true にするか、項目を消してください`);
    checkChecklist(t, `タスク ${t.id}`);
    const preds = t.predecessors ?? [];
    for (const pid of preds) {
      if (!taskIds.has(pid)) err(`タスク ${t.id}: 存在しない前のタスク "${pid}"`);
      if (pid === t.id) err(`タスク ${t.id}: 自分自身を前のタスクにしています（循環）`);
    }
    const predDue = preds.map((id) => data.tasks.find((x) => x.id === id)?.due).filter(isDate);
    if (isDate(t.due) && predDue.length && predDue.reduce((a, b) => (a > b ? a : b)) > t.due) warn(`タスク ${t.id}: 前のタスクの期限が自分の期限より後です`);
    if (t.waitingOn && !isDate(t.waitingOn.since)) err(`タスク ${t.id}: 待ち開始日 (waitingOn.since) の形式が不正です`);
    if (t.waitingOn?.expected != null && !isDate(t.waitingOn.expected)) err(`タスク ${t.id}: 回答予定日 (waitingOn.expected) の形式が不正です`);
    if (t.status === "Waiting" && !t.waitingOn) warn(`タスク ${t.id}: Waiting なのに待ち先 (waitingOn) がありません`);
    if (isDate(t.start) && isDate(t.due) && t.start > t.due) err(`タスク ${t.id}: 開始日が期限より後です`);

    for (const s of t.sessions ?? []) {
      const notStarted = checkSession(s, `タスク ${t.id} の枠 ${s.id}`);
      if (notStarted && isClosed(t) && s.kind === "planned" && !s.actual) warn(`タスク ${t.id}: ${t.status} なのに未来の予定枠 ${s.id} が残っています`);
    }
  }

  const weekTodoIds = new Set(todos.filter((t) => t.scope === "week").map((t) => t.id));
  for (const t of todos) {
    const who = `ToDo ${t.id}`;
    if (typeof t.id !== "string" || !/^T-\d{4}$/.test(t.id)) err(`${who}: ID は T-0001 の形にしてください`);
    if (data.tasks.some((x) => x.id === t.id)) err(`${who}: タスクと ID が重なっています`);
    if (!["week", "day"].includes(t.scope)) err(`${who}: scope は week か day にしてください ("${t.scope}")`);
    if (typeof t.title !== "string" || !t.title.trim()) err(`${who}: 件名が空です`);
    if (!isDate(t.date)) err(`${who}: 日付の形式が不正です (${t.date})`);
    else if (t.scope === "week" && weekday(t.date) !== 1) err(`${who}: 週の ToDo の日付は、月曜日にしてください (${t.date})`);
    if (t.parentId != null) {
      if (t.scope !== "day") err(`${who}: parentId を持てるのは、日の ToDo だけです`);
      else if (!weekTodoIds.has(t.parentId)) err(`${who}: parentId "${t.parentId}" は、存在する週の ToDo ではありません`);
    }
    if (t.doneAt != null && !isDate(t.doneAt)) err(`${who}: 完了日の形式が不正です (${t.doneAt})`);
    if (!(Number.isInteger(t.carried) && t.carried >= 0)) err(`${who}: carried は 0 以上の整数にしてください`);
    checkChecklist(t, who);
    for (const s of t.sessions ?? []) checkSession(s, `${who} の枠 ${s.id}`);
  }

  const cycle = findCycle(data.tasks);
  if (cycle) err(`前のタスクが循環しています: ${cycle.join(" → ")}`);

  // 同じ日の同じ種別の枠どうしの重なり（予定と実績は重なってよい。タスクと ToDo をまたいで判定）。実績は、実績だけの枠と予定の枠の actual（実績の区間）を合わせて比べる
  // 日付で束ねて、同じ日の中だけ総当たりにする（全枠の総当たりは、数年分で秒単位になる）
  const byDay = new Map();
  const put = (date, x) => { if (!byDay.has(date)) byDay.set(date, []); byDay.get(date).push(x); };
  for (const t of [...data.tasks, ...todos]) {
    for (const s of t.sessions ?? []) {
      if (isDate(s.date) && isTime(s.start) && isTime(s.end)) put(s.date, s);
      const a = s.actual;
      if (s.kind === "planned" && isObj(a) && isDate(a.date) && isTime(a.start) && isTime(a.end)) put(a.date, { id: `${s.id} の実績`, kind: "actual", start: a.start, end: a.end });
    }
  }
  for (const [date, list] of byDay) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].kind === list[j].kind && overlap(list[i], list[j])) err(`枠 ${list[i].id} と ${list[j].id} が重なっています (${date})`);
      }
    }
  }

  for (const e of data.events) {
    if (!isDate(e.date) || !isTime(e.start) || !isTime(e.end)) err(`会議 ${e.id}: 日付または時刻の形式が不正です`);
    else if (toMin(e.end) <= toMin(e.start)) err(`会議 ${e.id}: 終了が開始以前です`);
    if (!["mcp", "manual"].includes(e.source)) err(`会議 ${e.id}: 不明な source "${e.source}"`);
    if (e.projectId != null && !projectIds.has(e.projectId)) err(`会議 ${e.id}: 不明な projectId "${e.projectId}"`);
    if (e.projectBy != null && !["rule", "manual"].includes(e.projectBy)) err(`会議 ${e.id}: 不明な projectBy "${e.projectBy}"`);
    if (e.confirmed != null && typeof e.confirmed !== "boolean") err(`会議 ${e.id}: confirmed が真偽値ではありません`);
    if (e.actual != null && !(isTime(e.actual.start) && isTime(e.actual.end) && toMin(e.actual.end) > toMin(e.actual.start))) err(`会議 ${e.id}: actual は HH:MM の開始と終了にしてください（終了は開始より後）`);
  }

  const st = data.settings ?? {};
  // 形の違う設定は、注意にとどめる（読む側は、既定値で動く）
  if (st.waitingLongDays != null && !(Number.isInteger(st.waitingLongDays) && st.waitingLongDays >= 1)) {
    warn("settings.waitingLongDays: 1 以上の整数にしてください（直すまで、遅延バッジと「今日の優先」の待ち長期化が正しく出ません）");
  }
  const lb = st.labels;
  if (lb != null && !(typeof lb === "object" && !Array.isArray(lb) && ["group", "subgroup"].every((k) => lb[k] === undefined || typeof lb[k] === "string"))) {
    warn("settings.labels: group・subgroup は文字列にしてください（既定の呼び名で動きます）");
  }
  if (st.countWeekendsAndHolidays != null && typeof st.countWeekendsAndHolidays !== "boolean") {
    warn("settings.countWeekendsAndHolidays: true か false にしてください（既定の false で動きます）");
  }
  const listOf = (v, ok) => Array.isArray(v) && v.every((x) => x && typeof x === "object" && isDate(x.date) && ok(x));
  if (st.holidays != null && !listOf(st.holidays, (x) => HOLIDAY_KINDS.includes(x.kind))) {
    warn(`settings.holidays: { date, kind } の配列にしてください（kind は ${HOLIDAY_KINDS.join("・")}。文字列の配列など、形の違う要素は画面から消せないので、data.json から直接直してください）`);
  }
  if (st.workdays != null && !listOf(st.workdays, () => true)) {
    warn("settings.workdays: { date } の配列にしてください（形の違う要素は、data.json から直接直してください）");
  }
  const nh = st.nationalHolidays;
  if (nh != null && !(typeof nh === "object" && isDate(nh.fetchedAt) && listOf(nh.dates, () => true))) {
    warn("settings.nationalHolidays: { fetchedAt, dates: [{ date }] } にしてください（次に営業日を使う提案を作るか、見張りを始めると、自動で取り直されます）");
  }
  (st.projectRules ?? []).forEach((r, i) => {
    if (!String(r?.keyword ?? "").trim()) err(`settings.projectRules[${i}]: keyword が空です`);
    if (!projectIds.has(r?.projectId)) err(`settings.projectRules[${i}]: 不明な projectId "${r?.projectId}"`);
  });
  for (const [pid, m] of Object.entries(st.wbsMappings ?? {})) {
    if (!projectIds.has(pid)) err(`settings.wbsMappings: 不明なプロジェクト "${pid}"`);
    if (!m || typeof m !== "object" || Object.values(m).some((x) => typeof x !== "string")) err(`settings.wbsMappings.${pid}: 値は文字列のオブジェクトにしてください`);
  }

  for (const [pid, w] of Object.entries(st.wbsImports ?? {})) {
    if (!projectIds.has(pid)) err(`settings.wbsImports: 不明なプロジェクト "${pid}"`);
    const okCount = (n) => Number.isInteger(n) && n >= 0;
    if (!w || typeof w !== "object" || !(w.file === null || typeof w.file === "string") || !isDate(w.at) || !okCount(w.added) || !okCount(w.updated)) {
      err(`settings.wbsImports.${pid}: file（文字列か null）・at（日付）・added と updated（0 以上の整数）にしてください`);
    }
  }

  const ib = data.inbox;
  if (ib != null) {
    if (typeof ib !== "object" || Array.isArray(ib)) err("inbox: オブジェクトにしてください");
    else {
      if (ib.watching != null && !(typeof ib.watching === "object" && typeof ib.watching.at === "string" && ib.watching.at)) err("inbox.watching: at（日時の文字列）が必要です");
      if (!Array.isArray(ib.requests)) err("inbox.requests: 配列にしてください");
      else {
        const seen = new Set();
        ib.requests.forEach((r, i) => {
          const w = `inbox.requests[${i}]`;
          if (!r || typeof r.id !== "string" || !r.id) { err(`${w}: id が必要です`); return; }
          if (seen.has(r.id)) err(`${w}: id "${r.id}" が重複しています`);
          seen.add(r.id);
          if (!REQUEST_STATUS.includes(r.status)) err(`${w}: 不明な status "${r.status}"`);
          if (r.projectId != null && !projectIds.has(r.projectId)) err(`${w}: 不明な projectId "${r.projectId}"`);
          if (!Array.isArray(r.thread) || r.thread.some((m) => !m || !["user", "claude"].includes(m.role) || typeof m.text !== "string" || typeof m.at !== "string")) err(`${w}: thread は {role（user か claude）, at, text} の配列にしてください`);
          if (r.proposal != null && (!Array.isArray(r.proposal.ops) || r.proposal.ops.some((o) => !OP_KINDS.includes(o?.op)))) err(`${w}: proposal.ops の op は ${OP_KINDS.join("・")} のいずれかにしてください`);
        });
      }
    }
  }

  for (const c of data.changeLog) {
    if (!isDate(c.at)) err("changeLog: 日付が不正です");
    if (!Number.isInteger(c.deltaDays)) err("changeLog: deltaDays が整数ではありません");
    if (c.cause != null && !CAUSES.includes(c.cause)) err(`changeLog: 不明な原因 "${c.cause}"`);
    if (c.source != null && !["wbs", "calendar", "inbox"].includes(c.source)) err(`changeLog: 不明な source "${c.source}"`);
  }

  if (data.orphanSessions?.length) warn(`共有ファイルに無いタスクの作業枠が ${data.orphanSessions.length} 件あります`);

  return { errors, warnings };
}
