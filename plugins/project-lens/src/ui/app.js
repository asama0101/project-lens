// ダッシュボード本体: 状態の保持、描画、保存、イベントの結線。判断ロジックは src/core、見た目は src/ui/views、データ編集は src/ui/edit.js。
const store = createPairStore();
const params = new URLSearchParams(location.search);
// ?today=2026-10-20&time=10:15 で「現在」を固定できる(デモ・動作確認用)
const clock = () => (params.get("today") ? { date: params.get("today"), time: params.get("time") ?? "10:15" } : nowLocal());

const S = {
  data: null, openError: "",
  screen: "gantt",
  filter: "all", gwin: "m6", hideDone: false,
  askDel: null, askDelProject: null, pendingWait: null, pendingDone: null, checkOpen: new Set(),
  sview: "week", sdate: clock().date, selSess: null, selMtg: null, mtgDraft: null, urgentDraft: null, actAdd: null, actDraft: null, taskEdit: null,
  prefs: loadPrefs(), settingsClosed: loadSettingsClosed(), tpop: null, addAt: null, last: null, ruleError: "",
  ib: { open: false, text: loadInboxDraft(), projectId: "", replies: {}, reasons: {}, causes: {} },
  wperiod: "day", wdate: clock().date,
  todoWeek: mondayOf(clock().date), tdOpen: null, tdCol: null, tdDraft: null, tdPlan: null, askDelSess: null, // 実績つきの枠の削除の確認を出している枠の id（メモリのみ）。ToDo 画面の週（月曜日）・完了の入力欄を開いているタスクと、開いた列（"today" か "week"）と、その下書き・「今日へ」の入力欄（{ key: タスクの id, start, minutes }。完了の入力欄とは同時に開かない）
};
const $ = (id) => document.getElementById(id);
const view = $("view");

/** 通知で言うタスクの名前（件名）。スケジュールでも出る通知は、ID でなく件名で言う */
const taskTitle = (id) => S.data.tasks.find((t) => t.id === id)?.title ?? id;

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------- 描画 ---------- */
/** 開始画面の、まだ開いていないファイルごとの案内と選ぶボタン */
const PICK = {
  shared: `<p><b>共有ファイルを選んでください。</b>プロジェクトとタスク（<code>/project-lens:init</code> が作った <code>.project-lens/data.json</code>）です。</p><button class="btn" data-open="shared">共有ファイルを選ぶ</button>`,
  personal: `<p><b>個人ファイルを選んでください。</b>自分の作業枠・予定・休み（既定は <code>.project-lens/personal.json</code>）です。</p><button class="btn" data-open="personal">個人ファイルを選ぶ</button>`,
};
function startScreen() {
  const canPick = typeof window.showOpenFilePicker === "function";
  const miss = store.missing();
  const names = miss.map((w) => S.last?.[w]?.name).filter(Boolean); // 前回のファイルを開くは、足りない方に記憶があるときだけ
  const errs = miss.map((w) => S.last?.[w]?.error).filter(Boolean);
  return `<section class="panel"><h2>データファイルを開いてください</h2>
    <p>共有ファイル（data.json）と個人ファイル（personal.json）の 2 つを選ぶと、画面が開きます。</p>
    ${canPick ? `${names.length ? `<p><button class="btn primary" data-reopen>前回のファイル（${esc(names.join("・"))}）を開く</button></p>` : ""}${miss.map((w) => PICK[w]).join("")}${miss.length === 1 ? `<p class="note">${miss[0] === "shared" ? "個人" : "共有"}ファイルは選びました。</p>` : ""}${errs.length ? `<p class="note">前回のファイルの記憶を読めませんでした（${esc(errs[0])}）。毎回ファイルを選ぶ必要があります。</p>` : ""}`
      : `<p class="note">このブラウザはファイルへの直接保存に対応していません。読み込みだけできます。共有ファイルと個人ファイルを、一度に 2 つ選んでください。変更したときは、画面上部の「JSON を書き出す」で、2 つのファイルを保存してください(Edge か Chrome なら直接保存できます)。</p><input type="file" multiple accept=".json,application/json" data-fileinput aria-label="共有ファイルと個人ファイルを選ぶ">`}
    ${S.openError ? `<p class="ask" style="max-width:none" role="alert">${esc(S.openError)}</p>` : ""}</section>`;
}

const scheduleOpts = () => ({ view: S.sview, date: S.sdate, now: clock(), selSess: S.selSess, selMtg: S.selMtg, mtgDraft: S.mtgDraft, urgentDraft: S.urgentDraft, actAdd: S.actAdd, actDraft: S.actDraft, taskEdit: S.taskEdit, pendingWait: S.pendingWait, showPrio: S.prefs.showPrio, showSkipped: S.prefs.showSkipped, showDue: S.prefs.showDue, pendingDone: S.pendingDone, askDelSess: S.askDelSess });

function renderBody() {
  const { date: today } = clock();
  if (!S.data) return startScreen();
  if (S.screen === "gantt" || S.screen === "list") {
    return renderProjects(S.data, today, { filter: S.filter, view: S.screen, window: S.gwin, hideDone: S.hideDone, askDel: S.askDel, askDelProject: S.askDelProject, pendingWait: S.pendingWait, pendingDone: S.pendingDone, checkOpen: S.checkOpen, addAt: S.addAt, tpop: S.screen === "gantt" ? S.tpop : null, showPrio: S.prefs.showPrio, showActual: S.prefs.showActual, now: clock() });
  }
  if (S.screen === "settings") return renderSettings(S.data, today, { ruleError: S.ruleError, closed: S.settingsClosed });
  if (S.screen === "todo") return renderTodo(S.data, today, { week: S.todoWeek, now: clock(), open: S.tdOpen, col: S.tdCol, draft: S.tdDraft, plan: S.tdPlan, urgentDraft: S.urgentDraft });
  if (S.screen === "workload") return renderWorkload(S.data, today, { period: S.wperiod, date: S.wdate, now: clock() });
  return renderSchedule(S.data, today, scheduleOpts());
}

/** ガントの編集の窓を、クリックした位置の近くに置く(画面の端に収める) */
function placeTaskPop() {
  const pop = view.querySelector("[data-tpop]");
  if (!pop || !S.tpop) return;
  const r = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(S.tpop.x + 10, innerWidth - r.width - 8))}px`;
  pop.style.top = `${Math.max(8, Math.min(S.tpop.y + 10, innerHeight - r.height - 64))}px`; // 下端の「Claude Code に依頼する」の帯に重ならないよう、下を空ける
}
function openTaskPop(id, x, y) {
  S.tpop = { id, x, y };
  S.focusSel = '[data-tpop] [data-f="title"]';
  render();
}

/** マイルストーンの段を決め直してから（行の高さが変わるため）、前のタスクの線を、画面にあるすべてのガント本体に引き直す */
function drawAllDeps() {
  const bodies = view.querySelectorAll(".gbody");
  layoutMilestones(bodies);
  drawDeps(bodies);
}

let lastSelKey = null; // 前の描き直しの選択の鍵（selectionKey）
function render() {
  hideTip();
  sync.rendered(); // 読み直しで待たせた描き直しは、この描き直しで済む
  if (S.tpop && !S.data.tasks.some((t) => t.id === S.tpop.id)) S.tpop = null; // 読み直しで対象のタスクが消えたら、窓も閉じる
  if (S.selSess && !allSessions(S.data).some((s) => s.id === S.selSess)) { S.selSess = null; S.taskEdit = null; } // 読み直しなどで選択中の枠が無くなったら、選択と編集欄を外す
  if (S.taskEdit && (S.screen !== "schedule" || !S.data.tasks.some((t) => t.id === S.taskEdit.id))) { S.taskEdit = null; S.selSess = null; } // スケジュールの編集欄も同じ（編集欄は枠の選択と一緒なので、選択も外す）
  if (S.askDelSess && (S.screen !== "schedule" || S.askDelSess !== S.selSess)) S.askDelSess = null; // 削除の確認は、その枠を選んでいる間だけ（枠の id は S.data.tasks で検証しない）
  if (S.tdOpen && (!S.data?.tasks.some((t) => t.id === S.tdOpen) || !["today", "week"].includes(S.tdCol))) { S.tdOpen = null; S.tdCol = null; S.tdDraft = null; } // 読み直しなどでタスクが無くなったら（開いた列が不正でも）、完了の入力欄を閉じる
  if (S.tdPlan && !S.data?.tasks.some((t) => t.id === S.tdPlan.key)) S.tdPlan = null; // 「今日へ」の入力欄も同じ
  const c = clock();
  $("todaylabel").textContent = `${c.date.replace(/-/g, "/")}(${wdJa(c.date)})`;
  document.querySelectorAll("nav [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.id === "tab-" + S.screen)));
  $("filebar").innerHTML = S.data ? `<button class="chip-btn pref" data-pref="actual" aria-pressed="${S.prefs.showActual}" title="ガントの実績の線を出したり隠したりします">ガント実績</button><span class="fsep" aria-hidden="true"></span><button class="btn primary" data-urgent-open title="突発タスクの入力欄を開きます">＋ 突発タスク</button><button class="btn" data-actadd title="予定の無い作業の実績を入れる欄を開きます">＋ 実績を追加</button><button class="btn" data-refresh title="ファイルを読み直します(Claude Code などが更新した内容を反映)">更新</button><button class="btn" data-open="shared" title="別の共有ファイル（data.json）を選びます">別の共有ファイル</button><button class="btn" data-open="personal" title="別の個人ファイル（personal.json）を選びます">別の個人ファイル</button>${typeof window.showOpenFilePicker === "function" ? "" : `<button class="btn" data-download>JSON を書き出す</button>`}` : "";
  renderBar();
  // ガントの横スクロール位置(全プロジェクトで同じ)とページの縦の位置は、編集で描き直しても保つ(表示期間・絞り込みなどを変えたときだけ今日の位置へ戻す)。
  // 描き直しの間、ページが縮んで scrollY が飛ばないよう、#view の高さを保つ
  const prevCount = view.querySelectorAll(".gscroll").length;
  const calTop = S.screen === "schedule" ? view.querySelector("#calslot")?.getBoundingClientRect().top : null; // スケジュールは、カレンダーの画面上の位置を保つ（上の入力欄が開閉しても、押した枠が動かない）
  const prevLeft = view.querySelector(".gscroll")?.scrollLeft ?? 0, prevY = window.scrollY, chipsLeft = view.querySelector(".chips-row")?.scrollLeft ?? 0;
  view.style.minHeight = `${view.offsetHeight}px`;
  const keepFocus = focusSelector(document.activeElement);
  try {
    view.innerHTML = renderBody();
  } catch (e) { // 手で直した日付の不正などで、描けない。固まらせず、理由と検証の結果（バナー）を出す
    view.innerHTML = `<section class="panel"><h2>画面を描けません</h2><p class="ask" style="max-width:none" role="alert">${esc(e.message)}</p><p>データファイル（data.json・personal.json）を直してから、このページを再読み込みしてください。</p></section>`;
    refreshBanner();
  }
  if (keepFocus && !S.focusSel) view.querySelector(keepFocus)?.focus();
  const bars = [...view.querySelectorAll(".gscroll")];
  const reset = S.resetScroll;
  if (S.resetScroll || !prevCount || !bars.length) scrollToday(false); // 枠の数が変わっても(完了を隠すなど)、位置は保つ
  else bars.forEach((c) => { c.scrollLeft = prevLeft; });
  S.resetScroll = false;
  // チップの行(横スクロール)は、描き直しても位置を保つ。選択中のチップが見えなければ、行の中だけを動かす(scrollIntoView はページの縦も動かすので使わない)
  const chips = view.querySelector(".chips-row");
  if (chips) {
    chips.scrollLeft = chipsLeft;
    const on = chips.querySelector('[aria-pressed="true"]');
    if (on) {
      const rr = chips.getBoundingClientRect(), cr = on.getBoundingClientRect();
      if (cr.left < rr.left) chips.scrollLeft -= rr.left - cr.left + 8;
      else if (cr.right > rr.right) chips.scrollLeft += cr.right - rr.right + 8;
    }
  }
  if (S.focusSel) {
    let el = null;
    try { el = view.querySelector(S.focusSel); } catch { /* 不正なセレクタは無視 */ }
    S.focusSel = null;
    if (el) { el.focus(); el.select?.(); }
  }
  window.scrollTo(0, prevY); view.style.minHeight = "";
  syncSticky();
  if (reset && S.screen === "schedule") scrollToMorning();
  else if (calTop != null && !reset && S.screen === "schedule") { const nt = view.querySelector("#calslot")?.getBoundingClientRect().top; if (nt != null) window.scrollBy(0, nt - calTop); }
  // 枠を選んだ・編集欄が変わった描き直しで、固定の段（編集欄など）が高くなって、選んだ枠が隠れたら、その下へ出す（同じ選択のままの描き直しでは動かさない）
  const selKey = S.screen === "schedule" ? selectionKey(S.selSess, S.taskEdit) : null;
  if (revealSelection(lastSelKey, selKey)) { const b = view.querySelector(".blk.sel")?.getBoundingClientRect(), top = stackBottom(); if (b && b.top < top) window.scrollBy(0, b.top - top - 8); }
  lastSelKey = selKey;
  drawAllDeps();
  placeTaskPop();
  if (S.hlId) {
    const row = view.querySelector(`[data-row="${CSS.escape(S.hlId)}"]`);
    S.hlId = null;
    if (row) { row.classList.add("hl"); row.scrollIntoView({ block: "center" }); setTimeout(() => row.classList.remove("hl"), 2200); }
  }
}

/** 描き直しの前後でフォーカスを保つための、入力欄を特定するセレクタ */
function focusSelector(el) {
  if (!el || !view.contains(el)) return null;
  const q = (k, v) => `[${k}="${CSS.escape(v)}"]`;
  const d = el.dataset;
  if (d.f && d.id) return q("data-f", d.f) + q("data-id", d.id);
  if (d.pf && d.pid) return q("data-pf", d.pf) + q("data-pid", d.pid);
  if (d.mf && d.pid) return q("data-mf", d.mf) + q("data-pid", d.pid) + q("data-i", d.i);
  if (d.gadd) return q("data-gadd", d.gadd);
  if (d.cktext) return q("data-cktext", d.cktext);
  if (d.ckadd) return q("data-ckadd", d.ckadd);
  if (d.ckdone) return q("data-ckdone", d.ckdone);
  if (d.ckdel) return q("data-ckdel", d.ckdel);
  if (d.cktoggle) return q("data-cktoggle", d.cktoggle);
  if (d.pref) return `[data-pref="${CSS.escape(d.pref)}"]`; // 右の列の取っ手
  if (d.sdue !== undefined) return "[data-sdue]"; // 週表示の期限の行の開閉
  if (d.set) return q("data-set", d.set);
  // 規則の欄は、書き換えるとキーワードが変わるので、行の位置（data-ri。書き換えても並びは変わらない）で探す
  if (d.rkw !== undefined) return `[data-rkw][data-ri="${CSS.escape(d.ri)}"]`;
  if (d.rpj !== undefined) return `[data-rpj][data-ri="${CSS.escape(d.ri)}"]`;
  if (d.rnew !== undefined) return "[data-rnew]";
  for (const k of ["hnew", "hto", "hnote", "wnew", "wnote"]) if (d[k] !== undefined) return `[data-${k}]`;
  if (d.rnewpj !== undefined) return "[data-rnewpj]";
  if (d.waitparty) return q("data-waitparty", d.waitparty);
  if (d.ug) return q("data-ug", d.ug); // 突発タスクの欄（読み直しで待たせた描き直しが、欄を移ったときに走る）
  for (const k of ["tdnote", "tf", "tdckadd", "tp"]) if (d[k] !== undefined) return q(`data-${k}`, d[k]); // ToDo 画面の欄（tf・tdckadd・tp）と、稼働画面の週の見返しの気づき（tdnote）
  return null;
}

/** カレンダー部分だけを描き直す(会議の入力欄を作り直さないため) */
function renderCal() {
  $("calslot").innerHTML = renderCalendar(S.data, clock().date, { ...scheduleOpts(), selSess: S.selSess, selMtg: S.selMtg });
}

/** ガントを開いたとき、今日が左から約 120px の位置になるようスクロールする(レイアウト確定後 = rAF 2 回待ち) */
function scrollToday(smooth) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    // なめらかに動かすのは先頭の枠だけにする(全部に出すと、そろえる処理と互いに止め合って動かない)。ほかの枠は alignGScrolls が追う
    const all = [...view.querySelectorAll(".gscroll")];
    for (const c of smooth ? all.slice(0, 1) : all) {
      const lane = c.querySelector(".g-lane");
      c.scrollTo({ left: Math.max(0, Math.round(lane.offsetWidth * +c.dataset.todayfrac - 120)), behavior: smooth ? "smooth" : "auto" });
    }
  }));
}

/** スケジュールの固定の段（ヘッダー・操作の行・入力欄・週表示の日付の見出し・期限の行）の下端（画面の y）。syncSticky が測った高さの和 */
function stackBottom() {
  const cs = getComputedStyle(document.documentElement), px = (k) => parseFloat(cs.getPropertyValue(k)) || 0;
  return px("--hh") + px("--stop-h") + px("--slot-h") + px("--dh-h") + px("--due-h");
}

/** スケジュールを開いたとき（画面の切り替え・ファイルを開いたとき・「＋ 突発タスク」）に、時間の軸の先頭に見せる時刻（分） */
const MORNING = 8 * 60;
/** スケジュールを開いたとき、今の時刻によらず、08:00 が固定の段（ヘッダー・操作の行・入力欄・週表示の日付の見出し・期限の行）のすぐ下（10px 下）に来るまで、ページを縦にスクロールする（時間の軸は 00:00〜24:00 で、先頭は夜中のため） */
function scrollToMorning() {
  const grid = view.querySelector(".cal-grid, .week .hrs");
  if (!grid) return;
  const r = grid.getBoundingClientRect();
  window.scrollTo(0, Math.max(0, window.scrollY + r.top + r.height * calendarGeometry().pc(MORNING) / 100 - stackBottom() - 10)); // 10px 下げて、08:00 の目盛りの文字が段に隠れないようにする
}

/* ---------- 保存 ---------- */
function banner(msg, actions = {}) {
  if (!msg && !actions.validated && S.data) { refreshBanner(); return; } // 空の文＝失敗の案内を下ろす。検証の結果を出し直す
  S.banner = { msg, actions };
  // 共有に無い枠の削除は、検証の注意に添える（失敗の案内には付けない）
  const orphans = actions.validated ? (S.data?.orphanSessions?.length ?? 0) : 0;
  if (!orphans) S.pendingOrphan = false;
  $("banner").innerHTML = bannerHtml(msg, actions, orphans, S.pendingOrphan);
}
/** データの検証結果（問題・注意）をバナーに出し直す。ファイルを読み直したあと・他の更新を取り込んだあとも、これで出す */
function refreshBanner() {
  const { errors, warnings } = validate(S.data, clock());
  banner(errors.length ? `データに問題があります: ${errors.slice(0, 3).join(" / ")}` : warnings.length ? `注意: ${warnings.slice(0, 2).join(" / ")}` : "", { validated: true });
}

/** 共有・個人の 2 つのファイルを、続けてダウンロードする（ブラウザが連続のダウンロードを確認することがある） */
function downloadJson() {
  exportFiles(S.data).forEach(({ name, text }, i) => setTimeout(() => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, i * 300));
}

/** 画面の入力欄で打ちかけ（打った文字が、まだ change で確定していない）か。描き直すと消えるので、読み直しの描き直しを待たせる */
function isEditing() {
  const el = document.activeElement;
  if (!el || !view.contains(el)) return false;
  const typing = el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "file", "button", "submit", "range", "color"].includes(el.type));
  return typing && el.value !== el.defaultValue;
}

/** 保存と読み直し（競合の当て直しを含む）。中身は ui/sync.js */
const sync = createSync({
  store, getData: () => S.data, setData: (d) => { S.data = d; if (!sync.failed) refreshBanner(); }, render, renderBar, banner, toast,
  visible: () => document.visibilityState !== "hidden", wantFast: () => S.ib.open, isEditing,
});

/** 編集を適用して描画・保存する。edit は、いまのデータへの差分（data → data）で、例外を投げたら理由を表示して、データは変えない。
 *  決まった結果を返す編集（() => data）は、競合のとき、最新のファイルに当て直すと、他の更新を消すので、書かない */
function apply(edit, msg, { partial = false, quiet = false } = {}) {
  let next;
  try { next = edit(S.data); } catch (e) { toast(e.message); if (partial) renderCal(); else render(); return false; }
  S.data = next;
  if (partial) renderCal(); else if (!quiet) render();
  if (msg) toast(msg);
  sync.persist(edit);
  return true;
}

/* ---------- ファイルを開く ---------- */
function loaded(data) {
  checkShape(data); // ファイルの読み込みは store が検査済み。ここは、ドロップしたファイルの経路のため
  S.data = data;
  S.tpop = null;
  S.checkOpen = new Set();
  sync.reset();
  S.ruleError = "";
  S.openError = "";
  S.pendingOrphan = false;
  refreshBanner();
}

/** mode: "choose"＝which（"shared" | "personal"）のファイル選択を出す / "reopen"＝前回のファイルを、権限の確認だけで開く。
 *  2 つとも開いたときだけデータが返り、画面を開く。片方だけなら、開始画面のまま、足りない方の案内を出す */
async function openFile(mode, which) {
  try {
    const data = await (mode === "reopen" ? store.reopen() : store.choose(which));
    if (data) { loaded(data); S.resetScroll = true; } else S.openError = "";
    if (store.rememberFailed) toast("このブラウザでは、選んだファイルを記憶できません。次回もファイルを選ぶ必要があります");
  } catch (e) {
    if (e?.name === "AbortError") return;
    S.openError = `開けません: ${e.message}`;
    if (S.data) toast(S.openError); // 開始画面は無いので、画面上部の案内ではなく、通知で知らせる
  }
  render();
}

/** 起動時: 権限が許可済みなら、前回のファイルを自動で開く。使えなければ、開始画面に前回のファイルを出す */
async function startup() {
  try {
    const data = await store.restore();
    if (data) { loaded(data); S.resetScroll = true; }
  } catch (e) { S.openError = `前回のファイルを開けません: ${e.message}`; }
  if (!S.data) S.last = await store.lastFile();
  render();
}

/** 設定タブのキーワード規則の編集。エラーは、規則の表の上に出す（描き直しで入力欄が元の値に戻る） */
function ruleApply(edit, msg, { inPlace = false } = {}) {
  try { edit(S.data); } catch (e) { S.ruleError = e.message; render(); return false; }
  S.ruleError = "";
  if (!inPlace) return apply(edit, msg);
  if (!apply(edit, msg, { quiet: true })) return false;
  view.querySelector(".note.err[role=alert]")?.remove();
  patchRuleRows();
  return true;
}

/** 規則の書き換え・プロジェクトの変更が成功したあとは、画面を描き直さず、行の値・属性・件数だけを直す
 *  （描き直すと、押そうとしていた「削除」などが作り直されて、そのクリックが無視される） */
function patchRuleRows() {
  const rules = S.data.settings.projectRules;
  const counts = ruleMeetingCounts(S.data);
  view.querySelectorAll("[data-rkw]").forEach((input) => {
    const i = Number(input.dataset.ri), r = rules[i];
    if (!r) return;
    const tr = input.closest("tr");
    input.dataset.rkw = r.keyword;
    input.value = r.keyword;
    input.setAttribute("aria-label", `キーワード ${r.keyword}`);
    const sel = tr.querySelector("[data-rpj]");
    sel.dataset.rpj = r.keyword;
    sel.value = r.projectId;
    sel.setAttribute("aria-label", `${r.keyword} のプロジェクト`);
    const del = tr.querySelector("[data-rdel]");
    del.dataset.rdel = r.keyword;
    del.setAttribute("aria-label", `${r.keyword} の規則を削除`);
    tr.querySelectorAll("[data-rmove]").forEach((b) => {
      const delta = b.dataset.rmove.slice(b.dataset.rmove.lastIndexOf("|") + 1);
      b.dataset.rmove = `${r.keyword}|${delta}`;
      b.setAttribute("aria-label", `${r.keyword} を${delta === "-1" ? "上" : "下"}へ`);
    });
    tr.querySelector("[data-rcount]").textContent = `${counts[i]} 件`;
  });
}

/** 規則の追加。エラーは通知だけにして、入力欄は描き直さない（打った文字を残す） */
function addRule() {
  S.ruleError = "";
  view.querySelector(".note.err[role=alert]")?.remove();
  const kw = view.querySelector("[data-rnew]")?.value ?? "", pid = view.querySelector("[data-rnewpj]")?.value;
  if (!pid) { toast("先にプロジェクトを追加してください"); return; }
  const edit = (d) => setProjectRule(d, kw, pid);
  try { edit(S.data); } catch (e) { toast(e.message); return; }
  apply(edit, "規則を保存しました（同じキーワードは置き換えます）");
}

/** 設定タブの休みの追加（終了日があれば期間）。エラーは通知だけにして、入力欄は描き直さない（打った内容を残す） */
function addHolidayFromInput() {
  const val = (k) => view.querySelector(`[data-${k}]`)?.value ?? "";
  const from = val("hnew"), to = val("hto"), kind = val("hkind"), note = val("hnote");
  const range = to !== "";
  let msg = "休みを追加しました";
  const edit = (d) => (range ? addHolidayRange(d, { from, to, kind, note }) : addHoliday(d, { date: from, kind, note }));
  try {
    edit(S.data);
    if (range) {
      const { days, skipped } = holidayRangeDays(S.data, from, to);
      const fetched = Array.isArray(S.data.settings?.nationalHolidays?.dates) || S.data.settings?.countWeekendsAndHolidays === true; // 土日祝を営業日に数える設定のときは何も除かないので、未取得の注意を付けない
      msg = `${days.length} 日を${kind}として登録しました${skipped ? `（${fetched ? "土日・祝日" : "土日"} ${skipped} 日は除外）` : ""}${fetched ? "" : "。日本の祝日は未取得のため、土日だけを除きました"}`;
    }
  } catch (e) { toast(e.message); return; }
  apply(edit, msg);
}

/** 設定タブの営業日の指定の追加 */
function addWorkdayFromInput() {
  const date = view.querySelector("[data-wnew]")?.value ?? "", note = view.querySelector("[data-wnote]")?.value ?? "";
  const edit = (d) => addWorkday(d, { date, note });
  try { edit(S.data); } catch (e) { toast(e.message); return; }
  apply(edit, "営業日の指定を追加しました");
}

/** 見出し行の「＋」の大項目・中項目（data-ag / data-asg）を、追加するタスクの置き場にする */
const placeOf = (el) => ({ group: el.dataset.ag ?? "", subgroup: el.dataset.asg ?? "" });

/** ガントの名前入力から追加する。空の名前は何もしない。追加できたら入力を閉じる */
function submitGAdd(input) {
  const name = input.value.trim(), pid = input.dataset.gadd, place = placeOf(input);
  if (!name) { toast("タスク名を入力してください"); return; }
  const before = S.data.tasks.map((t) => t.id);
  if (apply((d) => addTaskQuick(d, pid, name, clock().date, place))) {
    S.addAt = null; render();
    toast(`${S.data.tasks.map((t) => t.id).find((x) => !before.includes(x))} を追加しました。バーをドラッグして日程を決めます`);
  }
}

/* ---------- 選択と削除 ---------- */
const clearSel = () => { S.selSess = null; S.selMtg = null; S.mtgDraft = null; S.urgentDraft = null; S.actAdd = null; S.actDraft = null; S.taskEdit = null; S.tdOpen = null; S.tdCol = null; S.tdDraft = null; S.tdPlan = null; S.askDelSess = null; };
/** 作業枠を選ぶ（id が null なら外す）。規則は sessionSelection（編集欄も開く） */
const selectSession = (id) => { Object.assign(S, sessionSelection(S.data, id, S.taskEdit)); };

function deleteSelected() {
  if (S.selMtg) {
    const m = S.data.events.find((o) => o.id === S.selMtg);
    if (m && m.source === "mcp") { toast("予定表から取得した会議は削除できません。出席しない会議は「参加しない」にしてください"); return; }
    if (m) { const id = m.id; S.selMtg = null; apply((d) => deleteMeeting(d, id), `会議「${m.title}」を削除しました`); return; }
  }
  const s = allSessions(S.data).find((x) => x.id === S.selSess);
  if (!s) { toast("削除する枠を選んでください"); return; }
  if (s.kind === "planned" && s.actual) { S.askDelSess = s.id; render(); return; } // 実績つきの予定の枠は、消す前に確認を出す（消すのは data-delsessok）
  removeSelectedSession(s);
}
function removeSelectedSession(s) {
  S.selSess = null; S.taskEdit = null; S.askDelSess = null;
  apply((d) => removeSession(d, s.id), `${s.title} の${s.kind === "actual" ? "実績の枠" : s.actual ? "枠（実績つき）" : "予定の枠"}を削除しました`);
}

/** 表示の好み（今日の優先・ガント実績）を反転して保存する。今日の優先を閉じると、パネル内にしか出ない確認待ちは出す場所がなくなるので捨てる */
function togglePref(key) {
  S.pendingDone = null;
  if (key === "showPrio" && S.screen === "gantt") S.resetScroll = true; // 右の列の開け閉めでガントの幅が変わるので、横スクロールを今日の位置へ戻す（スケジュールでは戻さない。scrollToMorning でページが跳ぶため）
  S.prefs = { ...S.prefs, [key]: !S.prefs[key] };
  savePrefs(S.prefs);
  render();
}

/** 「更新」・バナーの再読込。読み直せなくても、保存していない編集を捨てる（sync.reset）。
 *  捨てると伝えた編集を残すと、次の保存で、最新のファイルに当て直されてしまう。失敗したときは、再読込のボタンつきのバナーを出す */
async function reloadFile(okMsg) {
  let err = null;
  try { S.data = await store.reload(); } catch (e) { err = e; }
  sync.reset();
  S.ruleError = "";
  if (err) banner(`読み直せません: ${err.message}（画面の内容は、まだファイルと違う可能性があります）`, { reload: true, download: true }); else { S.pendingOrphan = false; refreshBanner(); }
  render();
  toast(err ? err.message : okMsg);
}

/* ---------- クリック ---------- */
document.querySelector("nav").addEventListener("click", (e) => {
  const b = e.target.closest("[role=tab]");
  if (!b) return;
  S.screen = b.id.slice(4);
  S.tpop = null;
  S.pendingDone = null;
  S.ruleError = "";
  clearSel();
  S.resetScroll = true;
  render();
});
/** 突発タスクの入力欄を開く(ヘッダーと ToDo タブの左の列のボタン)。ToDo タブでは画面を移さず、開いていればそのまま残す */
function openUrgent() {
  if (S.screen === "todo" && S.urgentDraft) { view.querySelector('[data-ug="title"]')?.focus(); return; }
  clearSel(); S.tpop = null; S.pendingDone = null; S.ruleError = "";
  const date = S.screen === "schedule" ? S.sdate : clock().date;
  if (S.screen !== "todo") { S.screen = "schedule"; S.sdate = date; S.resetScroll = true; } // ToDo タブでは、その場で開く
  S.urgentDraft = { date, start: urgentDefaultStart(date, clock()), title: "", projectId: "", minutes: 30 };
  render(); view.querySelector('[data-ug="title"]')?.focus();
}

$("filebar").addEventListener("click", async (e) => {
  const pf = e.target.closest("[data-pref]");
  if (pf) { togglePref("showActual"); return; }
  if (e.target.closest("[data-urgent-open]")) { openUrgent(); return; }
  if (e.target.closest("[data-actadd]")) { // 予定の無い作業の実績を入れる欄。開いている日（スケジュール以外からは今日）を初期値にする
    clearSel(); S.tpop = null; S.pendingDone = null; S.ruleError = "";
    const date = S.screen === "schedule" ? S.sdate : clock().date;
    S.screen = "schedule"; S.sdate = date; S.resetScroll = true;
    S.actAdd = { date };
    render(); view.querySelector('[data-ac="task"]')?.focus();
    return;
  }
  if (e.target.closest("[data-refresh]")) {
    await sync.whenIdle();
    if (sync.failed && !S.confirmRefresh) { S.confirmRefresh = true; toast("保存できていない変更があります。もう一度「更新」を押すと破棄して読み直します"); return; }
    S.confirmRefresh = false;
    reloadFile("ファイルから読み直しました");
    return;
  }
  const pick = e.target.closest("[data-open]");
  if (pick) openFile("choose", pick.dataset.open);
  if (e.target.closest("[data-download]")) downloadJson();
});
$("banner").addEventListener("click", async (e) => {
  if (e.target.closest("[data-download]")) downloadJson();
  if (e.target.closest("[data-reload]")) reloadFile("再読込しました");
  const again = () => banner(S.banner.msg, S.banner.actions); // いま出している案内のまま、確認の状態だけ変えて描く
  if (e.target.closest("[data-orphan-clear]")) { S.pendingOrphan = true; again(); }
  if (e.target.closest("[data-orphan-cancel]")) { S.pendingOrphan = false; again(); }
  if (e.target.closest("[data-orphan-ok]")) {
    S.pendingOrphan = false;
    const n = S.data.orphanSessions?.length ?? 0;
    apply((d) => removeOrphanSessions(d), `共有ファイルに無いタスクの作業枠 ${n} 件を削除しました`);
    if (!sync.failed) refreshBanner(); else again();
  }
});

/** 画面の外(ヘッダー・余白)のクリックでも、枠・会議の選択と追加中の下書きを外す。
 *  画面の描き直しで target が DOM から外れる前に判定するため、キャプチャ段階で処理する */
document.addEventListener("click", (e) => {
  if (S.tpop && !view.contains(e.target)) { S.tpop = null; render(); return; } // ガントの編集の窓は、画面の外のクリックでも閉じる
  if (view.contains(e.target) || !(S.selSess || S.selMtg || S.mtgDraft || S.urgentDraft || S.actAdd || S.taskEdit)) return;
  if (e.target.closest("[data-delsel],[data-urgent-open]")) return; // 「＋ 突発タスク」は openUrgent が外す（ToDo タブで開いていれば、打った入力を残す）
  clearSel();
  render();
}, true);

view.addEventListener("click", (e) => {
  const q = (sel) => e.target.closest(sel);
  if (q("[data-pref]")) { togglePref("showPrio"); return; } // 右の列の取っ手
  if (q("[data-tpopclose]")) { S.tpop = null; render(); return; }
  const ckt = q("[data-cktoggle]");
  if (ckt) { const id = ckt.dataset.cktoggle; if (S.checkOpen.has(id)) S.checkOpen.delete(id); else S.checkOpen.add(id); render(); return; }
  const ckd = q("[data-ckdel]");
  if (ckd) { const [tid, iid] = ckd.dataset.ckdel.split("|"); apply((d) => removeChecklistItem(d, tid, iid)); return; }
  const ge = q("[data-gedit]");
  if (ge) { const r = ge.getBoundingClientRect(); openTaskPop(ge.dataset.gedit, e.detail ? e.clientX : r.left, e.detail ? e.clientY : r.bottom); return; } // キーボード(detail 0)は、ボタンの位置に出す
  // 編集の窓の外(バー・タスク名以外)のクリックで閉じる
  if (S.tpop && !q(".tpop,[data-gt],[data-gh]")) { S.tpop = null; render(); } // 閉じたあと、押したものの操作もそのまま行う
  if (q("[data-urgent-open]")) { openUrgent(); return; }
  let cleared = false;
  // 欄外のクリックで、枠・会議の選択と追加中の下書きを外す
  if ((S.selSess || S.selMtg || S.mtgDraft || S.urgentDraft || S.actAdd || S.taskEdit) && !q("[data-urgent-open],[data-dragsess],[data-actbar],[data-ghost],[data-mtg],[data-mact],[data-mghost],[data-delsel],[data-delsessok],[data-delsessno],.mtgform,.actform,[data-mtgadd],[data-actadd],[data-actsave],[data-actclear],[data-mtgact],[data-mtgactclear]")) { clearSel(); cleared = true; }
  const { date: today, time } = clock();
  const now = clock();

  if (q("[data-radd]")) { addRule(); return; }
  if (q("[data-hadd]")) { addHolidayFromInput(); return; }
  if (q("[data-wadd]")) { addWorkdayFromInput(); return; }
  const hdel = q("[data-hdel]");
  if (hdel) { apply((d) => removeHoliday(d, hdel.dataset.hdel), "休みを外しました"); return; }
  const wdel = q("[data-wdel]");
  if (wdel) { apply((d) => removeWorkday(d, wdel.dataset.wdel), "営業日の指定を外しました"); return; }
  const rmove = q("[data-rmove]");
  if (rmove) {
    const [kw, delta] = [rmove.dataset.rmove.slice(0, rmove.dataset.rmove.lastIndexOf("|")), Number(rmove.dataset.rmove.slice(rmove.dataset.rmove.lastIndexOf("|") + 1))];
    ruleApply((d) => moveProjectRule(d, kw, delta), "規則の順序を変えました");
    return;
  }
  const rdel = q("[data-rdel]");
  if (rdel) { ruleApply((d) => removeProjectRule(d, rdel.dataset.rdel), "規則を削除しました"); return; }
  if (q("[data-reopen]")) { openFile("reopen"); return; }
  const pick = !S.data && q("[data-open]"); // 開始画面の「共有／個人ファイルを選ぶ」。データがあるときの data-open は、プロジェクトの絞り込み（下）
  if (pick) { openFile("choose", pick.dataset.open); return; }
  /* プロジェクト画面 */
  const gw = q("[data-gwin]"); if (gw) { S.gwin = gw.dataset.gwin; S.resetScroll = true; render(); return; }
  if (q("[data-hidedone]")) { S.hideDone = !S.hideDone; render(); return; }
  if (q("[data-gotoday]")) { scrollToday(true); return; }
  const f = q("[data-filter]"); if (f) { S.filter = f.dataset.filter; S.resetScroll = true; render(); return; }
  const o = q("[data-open]"); if (o) { S.filter = o.dataset.open; S.screen = "list"; S.resetScroll = true; render(); return; }
  if (q("[data-addproject]")) {
    const before = S.data.projects.map((p) => p.id);
    if (apply((d) => addProject(d, { name: "新しいプロジェクト", type: "その他" }, today), "プロジェクトを追加しました。名前・期間を入力してください")) {
      const id = S.data.projects.map((p) => p.id).find((x) => !before.includes(x));
      S.filter = id; S.screen = "list"; S.resetScroll = true; S.focusSel = `[data-pf="name"][data-pid="${id}"]`; render();
    }
    return;
  }
  const rp = q("[data-rmpre]");
  if (rp) { const [id, pre] = rp.dataset.rmpre.split("|"); apply((d) => updateTask(d, id, { predecessors: d.tasks.find((t) => t.id === id).predecessors.filter((x) => x !== pre) }, today), "前のタスクを外しました"); return; }
  const at = q("[data-addat]");
  if (at) {
    const pid = at.dataset.addat, place = placeOf(at), before = S.data.tasks.map((t) => t.id);
    if (apply((d) => addTaskQuick(d, pid, "新しいタスク", today, place))) {
      const id = S.data.tasks.map((t) => t.id).find((x) => !before.includes(x));
      S.focusSel = `#f-${id}-t`; render(); toast(`${id} を追加しました`);
    }
    return;
  }
  const go = q("[data-gopen]");
  if (go) { S.addAt = { pid: go.dataset.gopen, ...placeOf(go) }; S.focusSel = `[data-gadd="${go.dataset.gopen}"]`; render(); return; }
  const gok = q("[data-gaddok]");
  if (gok) { submitGAdd(view.querySelector(`[data-gadd="${CSS.escape(gok.dataset.gaddok)}"]`)); return; }
  if (q("[data-gaddno]")) { S.addAt = null; render(); return; }
  const gn = q("[data-goto]");
  if (gn) { S.tpop = null; const t = S.data.tasks.find((x) => x.id === gn.dataset.goto); S.filter = t.projectId ?? "none"; S.screen = "list"; S.hlId = t.id; S.focusSel = `#f-${t.id}-t`; S.resetScroll = true; render(); return; }
  const ma = q("[data-msadd]");
  if (ma) { const p = S.data.projects.find((x) => x.id === ma.dataset.msadd); apply((d) => addMilestone(d, p.id, { name: "新しいマイルストーン", date: p.due }), "マイルストーンを追加しました"); return; }
  const md = q("[data-msdel]");
  if (md) { const [pid, i] = md.dataset.msdel.split("|"); apply((d) => deleteMilestone(d, pid, +i), "マイルストーンを削除しました"); return; }
  const dl = q("[data-del]"); if (dl) { S.askDel = dl.dataset.del; S.tpop = null; render(); return; }
  if (q("[data-delno]")) { S.askDel = null; render(); return; }
  const dy = q("[data-delyes]");
  if (dy) { const id = dy.dataset.delyes, name = taskTitle(id); S.askDel = null; apply((d) => deleteTask(d, id),`${name} を削除しました`); return; }
  const pd = q("[data-pdel]"); if (pd) { S.askDelProject = pd.dataset.pdel; render(); return; }
  if (q("[data-pdelno]")) { S.askDelProject = null; render(); return; }
  const pdy = q("[data-pdelyes]");
  if (pdy) { const id = pdy.dataset.pdelyes; S.askDelProject = null; if (S.filter === id) S.filter = "all"; apply((d) => deleteProject(d, id),"プロジェクトを削除しました"); return; }
  const wk = q("[data-waitok]");
  if (wk) { submitWait(wk.dataset.waitok); return; }
  if (q("[data-waitno]")) { S.pendingWait = null; render(); return; }
  if (q("[data-doneno]")) { S.pendingDone = null; render(); return; }
  const ck = q("[data-ckall]"); // チェックの警告の「残りをチェックして Done」（「未完了のまま」は無い）
  if (ck && S.pendingDone) {
    const pd = S.pendingDone;
    if (pd.future.length) { S.pendingDone = { ...pd, stage: "future", checkAll: true }; render(); return; } // 続けて予定枠の確認
    S.pendingDone = null;
    setStatus(pd.id, pd.status, [], true);
    return;
  }
  const dk = q("[data-doneok]");
  if (dk) {
    const pd = S.pendingDone; S.pendingDone = null;
    setStatus(pd.id, pd.status, pd.future.filter((sid) => futurePlanned(S.data, pd.id, clock()).includes(sid)), !!pd.checkAll); // 確認を出してから始まった枠は消さない
    return;
  }

  /* ToDo 画面 */
  const tw = q("[data-tdweek]"); if (tw) { moveTodoWeek(addDays(S.todoWeek, 7 * +tw.dataset.tdweek)); return; }
  if (q("[data-tdweek-today]")) { moveTodoWeek(mondayOf(today)); return; }
  const tdo = q("[data-tdopen]");
  if (tdo) { const id = tdo.dataset.tdopen, col = tdo.dataset.tdcol, same = S.tdOpen === id && S.tdCol === col; S.tdOpen = same ? null : id; S.tdCol = same ? null : col; S.tdDraft = null; S.tdPlan = null; S.focusSel = S.tdOpen ? '[data-tf="start"]' : null; render(); return; }
  const tdd = q("[data-tdckdel]"); // 入力欄の項目の削除。すぐタスクへ保存する。描き直しても入力が残るよう、先に下書きへ写す
  if (tdd) { const [tid, iid] = tdd.dataset.tdckdel.split(":"); S.tdDraft = tdFormDraft(tdd.closest(".tdform"), tid); apply((d) => removeChecklistItem(d, tid, iid)); return; }
  const tdca = q("[data-tdckall]"); // 入力欄のチェックを、すべて付ける（描き直さない。保存で書く）
  if (tdca) { // 欄の値を変えても change は起きないので、下書きへも写す（読み直しの描き直しで、チェックが戻らないように）
    const form = tdca.closest(".tdform"), key = form.querySelector("[data-tdsave]")?.dataset.tdsave;
    form.querySelectorAll("[data-tfck]").forEach((c) => { c.checked = true; });
    if (key && key === S.tdOpen) S.tdDraft = tdFormDraft(form, key);
    return;
  }
  const tds = q("[data-tdsave]"); // 完了の保存。入力欄の値は、押したときに読む。失敗しても打った値が消えないよう、先に下書きへ写す
  if (tds) {
    const id = tds.dataset.tdsave;
    S.tdDraft = tdFormDraft(tds.closest(".tdform"), id);
    const draft = S.tdDraft, title = taskTitle(id);
    let r;
    if (apply((d) => { r = completeTask(d, id, completeInput(draft), now); return r.data; }, null, { quiet: true })) {
      S.tdOpen = null; S.tdCol = null; S.tdDraft = null; render();
      const sp = r.spawned ? S.data.tasks.find((x) => x.id === S.data.tasks.find((y) => y.id === id).repeat.spawned) : null;
      toast(`「${title}」を ${draft.status} にしました${r.released ? `。未来の予定の枠 ${r.released} 件を解除しました` : ""}${sp ? `。次回（期限 ${fmtMD(sp.due)}）を作りました` : ""}`);
    }
    return;
  }
  if (q("[data-tdcancel]")) { S.tdOpen = null; S.tdCol = null; S.tdDraft = null; render(); return; }
  const tdp = q("[data-tdplan]"); // 今日へ（右の列の行）。開閉。完了の入力欄は閉じる
  if (tdp) { const id = tdp.dataset.tdplan; if (S.tdPlan?.key === id) { S.tdPlan = null; S.focusSel = null; render(); } else openPlan(id); return; }
  const tps = q("[data-tdplansave]"); // 今日に入れる（今日の予定の枠を足す）。欄の値は、押したときに読む。失敗しても打った値が消えないよう、先に S.tdPlan へ写す
  if (tps) {
    const id = tps.dataset.tdplansave;
    S.tdPlan = tdPlanDraft(tps.closest(".tdplan"), id);
    const { start, minutes } = S.tdPlan, title = taskTitle(id);
    if (!isTime(start)) { toast("開始を入力してください"); return; }
    const end = toHHMM(toMin(start) + minutes); // 23:59 を超えるときは、addSession のエラーに任せる
    let r;
    if (apply((d) => { r = addSession(d, id, { date: today, start, end }); if (r.error) throw new Error(r.error); return r.data; }, null, { quiet: true })) {
      S.tdPlan = null; render();
      toast(`「${title}」を今日の ${start}–${end} に入れました${r.warning ? `（${r.warning}）` : ""}`);
    }
    return;
  }
  if (q("[data-tdplancancel]")) { S.tdPlan = null; render(); return; }

  /* 稼働画面 */
  const wp = q("[data-wperiod]"); if (wp) { S.wperiod = wp.dataset.wperiod; render(); return; }
  const wn = q("[data-wnav]"); if (wn) { S.wdate = shiftWorkloadDate(S.wperiod, S.wdate, +wn.dataset.wnav); render(); return; }
  if (q("[data-wtoday]")) { S.wdate = today; render(); return; }

  /* スケジュール画面 */
  const sv = q("[data-sview]"); if (sv) { S.sview = sv.dataset.sview; render(); return; }
  const nv = q("[data-nav]"); if (nv) { S.sdate = addDays(S.sdate, +nv.dataset.nav); render(); return; }
  if (q("[data-sgoto]")) { S.sdate = today; render(); return; }
  if (q("[data-sskip]")) { togglePref("showSkipped"); return; }
  if (q("[data-sdue]")) { togglePref("showDue"); return; }
  const dy0 = q("[data-day]"); if (dy0) { S.sdate = dy0.dataset.day; S.sview = "day"; render(); return; }
  const acs = q("[data-actsave]"); // 実績の保存。入力欄の値は、押したときに読む。data-actsave に枠の ID があれば、その予定の枠の actual を書く（なければ「＋ 実績を追加」）
  if (acs) {
    const f = (k) => view.querySelector(`[data-ac="${k}"]`)?.value ?? "", sid = acs.dataset.actsave;
    const note = (r) => (r.statusChanged ? `（状態を In Progress にしました${r.from === "Waiting" ? "。待ち先の記録は外しました" : ""}）` : "");
    let r;
    if (sid) { // 失敗しても打った値が消えないよう、検査の前に下書きへ写す
      const slot = { date: f("date"), start: f("start"), end: f("end") }, had = !!allSessions(S.data).find((x) => x.id === sid)?.actual;
      S.actDraft = { key: sid, task: "", ...slot };
      if (!isDate(slot.date) || !isTime(slot.start) || !isTime(slot.end)) { toast("日付・時刻を入力してください"); return; }
      if (apply((d) => { r = recordSlotActual(d, sid, slot, now); return r.data; }, null, { quiet: true })) {
        clearSel(); render();
        toast(had ? `${taskTitle(r.taskId)} の実績を ${slot.start}–${slot.end} に更新しました` : `${taskTitle(r.taskId)} の ${slot.start}–${slot.end} の実績を入れました${note(r)}`);
      }
      return;
    }
    const taskId = f("task"), slot = { date: f("date"), start: f("start"), end: f("end") };
    if (!taskId || !slot.date || !slot.start || !slot.end) { toast("タスク・日付・時刻を入力してください"); return; }
    if (apply((d) => { r = recordActual(d, taskId, slot, now); return r.data; }, null, { quiet: true })) {
      clearSel(); render();
      toast(`${taskTitle(taskId)} の ${slot.start}–${slot.end} の実績を入れました${note(r)}`);
    }
    return;
  }
  const acl = q("[data-actclear]"); // 予定の枠の実績（actual）だけを外す（予定の枠と選択は残る）
  if (acl) {
    const s = allSessions(S.data).find((x) => x.id === acl.dataset.actclear);
    if (s && apply((d) => { const r = clearActual(d, s.id); if (r.error) throw new Error(r.error); return r.data; }, null, { quiet: true })) {
      S.actDraft = null; S.askDelSess = null; render();
      toast(`${taskTitle(s.taskId)} の実績を消しました`);
    }
    return;
  }
  if (q("[data-actcancel]")) { S.actAdd = null; S.actDraft = null; render(); return; }
  const mact = q("[data-mtgact]"); // 会議の実績の保存（confirmed と actual を書く）
  if (mact) { const id = mact.dataset.mtgact, f = (k) => view.querySelector(`[data-ma="${k}"]`)?.value ?? "", span = { start: f("start"), end: f("end") }, upd = S.data.events.find((m) => m.id === id)?.confirmed === true; if (apply((d) => setMeetingActual(d, id, span, now), upd ? "会議の実績を更新しました" : "会議の実績を入れました")) S.actDraft = null; return; }
  const mclr = q("[data-mtgactclear]"); // 会議の実績を消す（actual を外し、confirmed を false に戻す）
  if (mclr) { if (apply((d) => clearMeetingActual(d, mclr.dataset.mtgactclear), "会議の実績を消しました")) S.actDraft = null; return; }
  if (q("[data-delsel]")) { deleteSelected(); return; }
  const dsok = q("[data-delsessok]");
  if (dsok) { const s = allSessions(S.data).find((x) => x.id === dsok.dataset.delsessok); if (s && S.askDelSess === s.id) removeSelectedSession(s); else { S.askDelSess = null; render(); } return; }
  if (q("[data-delsessno]")) { S.askDelSess = null; render(); return; }
  const sb = q("[data-dragsess],[data-actbar],[data-ghost]"); // 予定のブロック・実績のブロック・影は、同じ枠を選ぶ
  if (sb && !q("[data-rz]")) { const id = sb.dataset.dragsess ?? sb.dataset.actbar ?? sb.dataset.ghost; selectSession(S.selSess === id ? null : id); S.selMtg = null; S.mtgDraft = null; S.urgentDraft = null; S.actAdd = null; S.actDraft = null; render(); return; }
  const mb = q("[data-mtg],[data-mact],[data-mghost]"); // 予定の会議・実績の会議・影は、同じ会議を選ぶ
  if (mb && !q("[data-rzm]")) { const id = mb.dataset.mtg ?? mb.dataset.mact ?? mb.dataset.mghost; S.selMtg = S.selMtg === id ? null : id; S.selSess = null; S.mtgDraft = null; S.urgentDraft = null; S.actAdd = null; S.actDraft = null; S.taskEdit = null; render(); return; }
  if (q("[data-mtgadd]")) {
    const base = S.sdate === today ? Math.ceil((toMin(time) + 1) / 60) * 60 : 10 * 60;
    const st = Math.min(base, 22 * 60); // 1 時間の会議が 23:59 までに収まる、最後の正時
    clearSel(); S.mtgDraft = { date: S.sdate, start: toHHMM(st), end: toHHMM(st + 60), title: "", skip: false };
    render(); toast("会議の内容を入力して「追加」を押してください"); return;
  }
  if (q("[data-mtgsave]")) {
    const m = S.mtgDraft; let id;
    const clash = allSessions(S.data).some((s) => s.date === m.date && toMin(s.start) < toMin(m.end) && toMin(s.end) > toMin(m.start));
    if (apply((d) => { const r = addMeeting(d, m); id = r.id; return r.data; }, clash ? "会議を追加しました。配置済みの枠と重なっています" : "会議を追加しました")) { S.mtgDraft = null; S.selMtg = id; S.sdate = m.date; render(); }
    return;
  }
  if (q("[data-mtgcancel]")) { S.mtgDraft = null; render(); return; }
  if (q("[data-mtgclose]")) { S.selMtg = null; render(); return; }
  if (q("[data-urgsave]")) { submitUrgent(); return; }
  if (q("[data-tedit-full]")) { S.taskEdit = { ...S.taskEdit, full: !S.taskEdit.full, askDel: false }; render(); return; }
  if (q("[data-tedit-close]")) { clearSel(); render(); return; } // 編集欄は枠の選択と一緒に出るので、閉じると選択も外す
  if (q("[data-tedit-del]")) { S.taskEdit = { ...S.taskEdit, askDel: true }; render(); return; }
  if (q("[data-tedit-delno]")) { S.taskEdit = { ...S.taskEdit, askDel: false }; render(); return; }
  if (q("[data-urgcancel]")) { S.urgentDraft = null; render(); return; }
  if (cleared) render();
});

/** ToDo 画面の週を動かす（完了の入力欄は閉じる） */
function moveTodoWeek(week) {
  S.todoWeek = week; S.tdOpen = null; S.tdCol = null; S.tdDraft = null; S.tdPlan = null;
  render();
}

/** 「今日へ」の入力欄を、そのタスクの行の下に開く（「今日へ」のボタンと、左の列へのドロップで共通）。完了の入力欄は閉じる */
function openPlan(id) {
  S.tdPlan = { key: id, ...planDefault(clock()) }; S.tdOpen = null; S.tdCol = null; S.tdDraft = null; S.focusSel = '[data-tp="start"]';
  render();
}

/** 「今日へ」の入力欄（.tdplan）の値 → S.tdPlan（{ key, start, minutes }） */
function tdPlanDraft(form, key) {
  const f = (k) => form?.querySelector(`[data-tp="${k}"]`)?.value ?? "";
  return { key, start: f("start"), minutes: +f("minutes") };
}

/** 完了の入力欄（.tdform）の値 → 下書き（{ key, date, start, end, status, checks }） */
function tdFormDraft(form, key) {
  const f = (k) => form?.querySelector(`[data-tf="${k}"]`)?.value ?? "";
  const checks = Object.fromEntries([...(form?.querySelectorAll("[data-tfck]") ?? [])].map((c) => [c.dataset.tfck, c.checked]));
  return { key, date: f("date"), start: f("start"), end: f("end"), status: f("status"), checks };
}

/** 突発タスクの入力欄の確定。件名が空なら何もしない。Error のときは通知だけで、入力欄を残す */
function submitUrgent() {
  const u = S.urgentDraft, f = (k) => view.querySelector(`[data-ug="${k}"]`).value;
  if (!u) return;
  const r = urgentInput({ title: f("title"), projectId: f("projectId"), minutes: f("minutes"), date: f("date"), start: f("start") });
  S.urgentDraft = { ...u, title: f("title").trim(), projectId: f("projectId"), minutes: +f("minutes"), date: f("date"), start: f("start") }; // 空・Error で描き直しても、入力を残す
  if (!r) return;
  const { input } = r, title = input.title;
  let warning;
  if (apply((d) => { const r = addUrgentTask(d, input); warning = r.warning; return r.data; }, null, { quiet: true })) {
    S.urgentDraft = null; if (S.screen !== "todo") S.sdate = input.date; render();
    toast(`${title} を ${input.start} に ${input.minutes} 分で登録しました${warning ? `(${warning})` : ""}`);
  }
}

/** 状態の変更（リストの select・編集の窓・スケジュールの編集欄）。待ち先・未来の予定枠の確認が要るときは、確認待ちにする */
function changeStatus(id, status) {
  S.pendingDone = null; S.pendingWait = null; // 選び直したら、前の確認（Done の警告・待ち先の入力）を外す。要るときは下で立て直す
  const t = S.data.tasks.find((x) => x.id === id);
  if (status === "Waiting" && !t.waitingOn?.party) { S.pendingWait = id; S.focusSel = `[data-waitparty="${id}"]`; render(); return; }
  const { open, future } = planDone(S.data, id, status, clock());
  // 未チェックの項目がある（Done のとき）、または未来の予定枠を消す（Done・Cancelled のとき）なら、確認する。先にチェックの警告、次に予定枠
  if (open.length || future.length) { S.pendingDone = { id, status, n: future.length, future, open, stage: open.length ? "check" : "future", checkAll: false }; render(); return; }
  setStatus(id, status, []);
}

function setStatus(id, status, future, checkAll = false) {
  const kept = status === "Done" || status === "Cancelled" ? runningPlanned(S.data, id, clock()).length : 0; // 完了にしても進行中の枠は残る
  const keptMsg = kept ? `。進行中の枠 ${kept} 件は残しました（終わったら、スケジュールで実績を入れます）` : "";
  const n0 = S.data.tasks.length;
  const doneMsg = future.length ? `${taskTitle(id)} の状態を ${status} にしました。未来の予定の枠 ${future.length} 件を解除しました${keptMsg}` : `変更を保存しました${keptMsg}`;
  apply((d) => {
    let next = updateTask(d, id, { status }, clock().date);
    if (checkAll) next = checkAllChecklist(next, id);
    for (const sid of future) next = removeSession(next, sid);
    return status === "Done" ? spawnNextRepeat(next, id, clock().date) : next; // 定例なら、次回を作る
  }, doneMsg);
  if (S.data.tasks.length > n0) {
    const sp = S.data.tasks.find((x) => x.id === S.data.tasks.find((y) => y.id === id).repeat.spawned);
    toast(`${doneMsg}。次回（期限 ${fmtMD(sp.due)}）を作りました`);
  }
}

function submitWait(id) {
  const input = view.querySelector(`[data-waitparty="${id}"]`);
  const party = input.value.trim();
  if (!party) { toast("待ち先を入力してください"); return; }
  S.pendingWait = null;
  apply((d) => updateTask(d, id, { status: "Waiting", waitingOn: { party, since: clock().date } }, clock().date), `${taskTitle(id)} を Waiting にしました`);
}

/* ---------- 入力の変更 ---------- */
// 入力欄から次の欄へ移るとき、フォーカスの移動が終わってから描き直す(先に描き直すと移動先が消える)
/** チェックリストの追加欄: Enter で追加する。日本語入力の変換確定の Enter（isComposing）では追加しない */
view.addEventListener("keydown", (e) => {
  const el = e.target.closest("[data-ckadd]");
  if (!el || e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  const text = el.value.trim(), id = el.dataset.ckadd;
  if (!text) return;
  S.focusSel = `[data-ckadd="${id}"]`;
  apply((d) => addChecklistItem(d, id, text));
});
/** 完了の入力欄の、項目の追加欄: Enter ですぐタスクへ保存する（isComposing では追加しない）。描き直しても入力が残るよう、先に下書きへ写す */
view.addEventListener("keydown", (e) => {
  const el = e.target.closest("[data-tdckadd]");
  if (!el || e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  const text = el.value.trim(), id = el.dataset.tdckadd;
  if (!text) return;
  S.tdDraft = tdFormDraft(el.closest(".tdform"), id);
  S.focusSel = `[data-tdckadd="${id}"]`;
  apply((d) => addChecklistItem(d, id, text));
});
/**
 * 日付の欄（data-date）の確定: 打った文字（2026/10/20・20261020 など）を YYYY-MM-DD に直して el.value に入れる（以後の処理は、いつも YYYY-MM-DD を読む）。
 * 読めないときは、元の値に戻して通知し、false を返す（呼び出し側が、その確定を止める）。空は、欄ごとの扱いのまま通す
 */
function normalizeDateField(el) {
  const v = el.value.trim();
  if (!v) { el.value = ""; return true; }
  const iso = parseDateInput(v);
  if (iso) { el.value = iso; return true; }
  el.value = el.defaultValue;
  el.classList.add("bad");
  setTimeout(() => el.classList.remove("bad"), 1600);
  toast("日付は 2026/10/20 の形で入力してください");
  return false;
}
// 日付の欄の確定は、ほかの change の処理より先に（キャプチャ段階で）直す。読めない値は、ほかの処理に渡さない。
// 「📅」で選んだ日（隠れた日付の欄 .dpick-in の change）は、文字の欄に写して、文字の欄の change として流す
view.addEventListener("change", (e) => {
  const el = e.target;
  if (el.matches?.(".dpick-in")) {
    e.stopImmediatePropagation();
    const field = el.closest(".dfield")?.querySelector("[data-date]");
    if (field && el.value) { field.value = el.value; field.dispatchEvent(new Event("change", { bubbles: true })); }
    return;
  }
  if (el.matches?.("[data-date]") && !normalizeDateField(el)) e.stopImmediatePropagation();
}, true);
// Enter で確定する欄（休み・営業日の追加）も、先に日付を直す
view.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing || !e.target.matches?.("[data-date]")) return;
  if (!normalizeDateField(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
// 「📅」: 隠れた日付の欄に今の値を入れて、ブラウザの日付の選択を開く（showPicker が使えないときは、その欄を押す）
view.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-datepick]");
  if (!b) return;
  e.stopImmediatePropagation();
  const box = b.closest(".dfield"), pick = box.querySelector(".dpick-in"), field = box.querySelector("[data-date]");
  pick.value = parseDateInput(field.value) ?? "";
  try { pick.showPicker(); } catch { pick.focus(); pick.click(); }
}, true);
view.addEventListener("change", (e) => { const el = e.target; setTimeout(() => onChange(el), 0); });
// 設定タブの節の開閉は、描き直さずに記録して保存する（toggle はバブリングしないので、キャプチャで受ける）。描き直しでは S.settingsClosed から開閉を復元する
view.addEventListener("toggle", (e) => {
  const el = e.target;
  if (!el.matches("details[data-fold]")) return;
  const id = el.dataset.fold;
  if (S.settingsClosed.includes(id) === !el.open) return; // 記録と同じ（描画時に open の節で発火する toggle など）
  S.settingsClosed = el.open ? S.settingsClosed.filter((x) => x !== id) : [...S.settingsClosed, id];
  saveSettingsClosed(S.settingsClosed);
}, true);

/** 設定タブの基本の設定を保存する。不正な値は通知して、入力を元に戻す */
function changeSetting(el) {
  const k = el.dataset.set;
  if (k === "countWeekendsAndHolidays") { apply((d) => updateSettings(d, { countWeekendsAndHolidays: el.checked }), "設定を保存しました"); return; } // 描き直して、祝日・休みの節の説明を切り替える
  let patch;
  if (k === "waitingLongDays") patch = { waitingLongDays: Number(el.value) };
  else patch = { labels: { [k.slice("label-".length)]: el.value } }; // label-group / label-subgroup
  // 成功したら描き直さない（描き直すとフォーカスが消える）。不正な値は、先に検査して通知し、入力欄だけを元に戻す（restoreSettingInputs）
  const edit = (d) => updateSettings(d, patch);
  try { edit(S.data); } catch (e) { toast(e.message); restoreSettingInputs(); return; } // 描き直すとフォーカスが消えるので、入力欄だけ元に戻す
  apply(edit, "設定を保存しました", { quiet: true });
  if (k.startsWith("label-")) el.value = groupLabels(S.data.settings)[k.slice("label-".length)]; // 空・前後の空白は、保存された値（空なら既定の呼び名）を出す。ほかの呼び名の注意は残す
  else el.closest("tr")?.querySelectorAll(".note.err").forEach((n) => n.remove()); // 直した項目の古い注意を消す（行の値をまるごと保存し直す項目だけ）
}

/** 不正な入力を、保存されている値（無ければ既定値）に戻す */
function restoreSettingInputs() {
  const v = settingsInputValues(S.data);
  const set = (name, value) => { const input = view.querySelector(`[data-set="${name}"]`); if (input) input.value = value; };
  set("waitingLongDays", v.waitingLongDays); // 呼び名は不正にならない（updateSettings が例外にするのは待ち長期化の日数だけ）
}

// 読み直しで待たせた描き直しは、入力が確定した（onChange のあと）・フォーカスが移り終わったあとに行う
// マウスを押している間はしない（押したボタンが描き直しで作り直されると、離したときのクリックが届かない）。離したあと（click の処理のあと）に行う
let pressing = false, pressTimer = null;
const flushSoon = () => setTimeout(() => { if (!pressing) sync.flush(); }, 0);
const release = () => { if (!pressing) return; pressing = false; clearTimeout(pressTimer); flushSoon(); };
document.addEventListener("pointerdown", () => { pressing = true; clearTimeout(pressTimer); pressTimer = setTimeout(release, 3000); }, true); // 離した知らせが来ないときも、待たせた描き直しを失わない
document.addEventListener("pointerup", release, true);
document.addEventListener("pointercancel", release, true);
view.addEventListener("change", flushSoon);
view.addEventListener("focusout", flushSoon);

function onChange(el) {
  const { date: today } = clock();
  if (el.dataset.fileinput !== undefined) {
    if (!el.files?.length) return;
    Promise.all([...el.files].map((f) => f.text())).then((texts) => { try { loaded(dataFromTexts(texts, [...el.files].map((f) => f.name))); } catch (err) { S.openError = `開けません: ${err.message}`; } render(); });
    return;
  }
  // 突発タスクの欄は、確定した値を下書きに残す（読み直しの描き直しで、打った内容を消さない）
  if (el.dataset.ug !== undefined) { if (S.urgentDraft) S.urgentDraft = { ...S.urgentDraft, [el.dataset.ug]: el.dataset.ug === "minutes" ? +el.value : el.value }; return; }
  // 実績の欄も同じ。どの欄の下書きかを key で持ち、描き直しても入力を残す（保存の成功・キャンセル・選択の変更で消す）
  if (el.dataset.ac !== undefined || el.dataset.ma !== undefined) {
    const form = el.closest(".actform"), g = (a, k) => form?.querySelector(`[data-${a}="${k}"]`)?.value ?? "";
    const mid = form?.querySelector("[data-mtgact]")?.dataset.mtgact, sid = form?.querySelector("[data-actsave]")?.dataset.actsave;
    if (mid !== undefined || sid !== undefined) S.actDraft = { key: mid !== undefined ? `m:${mid}` : sid || "add", task: g("ac", "task"), date: g("ac", "date"), start: g(mid !== undefined ? "ma" : "ac", "start"), end: g(mid !== undefined ? "ma" : "ac", "end") };
    return;
  }
  // ToDo 画面
  if (el.dataset.tf !== undefined || el.dataset.tfck !== undefined) { // 完了の入力欄の下書き（描き直しても入力を残す）。この欄を開いたままのときだけ
    const form = el.closest(".tdform"), key = form?.querySelector("[data-tdsave]")?.dataset.tdsave;
    if (key && key === S.tdOpen) S.tdDraft = tdFormDraft(form, key);
    return;
  }
  if (el.dataset.tp !== undefined) { // 「今日へ」の入力欄も同じ。この欄を開いたままのときだけ
    const form = el.closest(".tdplan"), key = form?.querySelector("[data-tdplansave]")?.dataset.tdplansave;
    if (key && key === S.tdPlan?.key) S.tdPlan = tdPlanDraft(form, key);
    return;
  }
  if (el.dataset.tdnote !== undefined) { const wk = el.dataset.tdnote, text = el.value.trim(); apply((d) => setReview(d, wk, text), "気づきを保存しました"); return; }
  if (el.dataset.mt) {
    const f = el.dataset.mt, v = f === "skip" ? el.checked : el.value;
    const m = S.mtgDraft ?? S.data.events.find((o) => o.id === S.selMtg);
    if (!m) return;
    const old = m[f];
    if (f === "start" && v && toMin(v) >= toMin(m.end)) {
      const end = toHHMM(Math.min(toMin(v) + (toMin(m.end) - toMin(m.start)), 23 * 60 + 45));
      const endInput = view.querySelector('[data-mt="end"]');
      if (S.mtgDraft) { S.mtgDraft = { ...m, start: v, end }; if (endInput) endInput.value = end; renderCal(); return; }
      if (apply((d) => updateMeeting(d, m.id, { start: v, end }), "会議を更新しました", { partial: true }) && endInput) endInput.value = end;
      return;
    }
    if (S.mtgDraft) {
      if (!v && f !== "title" && f !== "skip" && f !== "projectId") { el.value = old; toast("日付と時刻を入力してください"); return; }
      S.mtgDraft = { ...m, [f]: v };
      if (toMin(S.mtgDraft.end) <= toMin(S.mtgDraft.start)) { S.mtgDraft = m; el.value = old; toast("終了は開始より後にしてください"); return; }
      renderCal();
      return;
    }
    if (!v && f !== "title" && f !== "skip" && f !== "projectId") { el.value = old; toast("日付と時刻を入力してください"); return; }
    if (!apply((d) => updateMeeting(d, m.id, { [f]: v }), f === "skip" ? (v ? "参加しない会議にしました。稼働に数えず、作業枠と重なっても注意しません" : "参加する会議に戻しました") : "会議を更新しました", { partial: true })) { el.value = old; }
    return;
  }
  if (el.dataset.set !== undefined) { changeSetting(el); return; }
  if (el.dataset.hrowkind !== undefined) {
    const date = el.dataset.hrowkind, kind = el.value;
    apply((d) => addHoliday(d, { date, kind, note: (d.settings?.holidays ?? []).find((h) => h?.date === date)?.note }), "区分を変更しました");
    return;
  }
  if (el.dataset.rkw !== undefined) { const old = el.dataset.rkw; ruleApply((d) => renameProjectRule(d, old, el.value), "キーワードを変更しました", { inPlace: true }); return; }
  if (el.dataset.rpj !== undefined) { const kw = el.dataset.rpj, pid = el.value; ruleApply((d) => setProjectRule(d, kw, pid), "プロジェクトを変更しました", { inPlace: true }); return; }
  if (el.dataset.projectpick !== undefined) { S.filter = el.value; S.resetScroll = true; render(); return; }
  if (el.dataset.pf) {
    const k = el.dataset.pf, pid = el.dataset.pid;
    apply((d) => updateProject(d, pid, { [k]: el.value }), "プロジェクトを更新しました");
    return;
  }
  if (el.dataset.mf) {
    const pid = el.dataset.pid, i = +el.dataset.i;
    apply((d) => updateMilestone(d, pid, i, { [el.dataset.mf]: el.value }), "マイルストーンを更新しました");
    return;
  }
  if (el.dataset.ckdone !== undefined) {
    const [tid, iid] = el.dataset.ckdone.split("|"), done = el.checked;
    apply((d) => updateChecklistItem(d, tid, iid, { done }));
    return;
  }
  if (el.dataset.cktext !== undefined) {
    const [tid, iid] = el.dataset.cktext.split("|"), text = el.value;
    apply((d) => updateChecklistItem(d, tid, iid, { text })); // 空にすると例外のトーストが出て、描き直しで元に戻る
    return;
  }
  if (el.dataset.addpre !== undefined) {
    if (el.value) {
      const id = el.dataset.addpre, pre = el.value;
      apply((d) => addPredecessor(d, id, pre, today), "前のタスクを追加しました");
    }
    return;
  }
  if (el.dataset.f) {
    const id = el.dataset.id, f = el.dataset.f;
    const t = S.data.tasks.find((x) => x.id === id);
    if (f === "status") { changeStatus(id, el.value); return; }
    if (f === "projectId") { apply((d) => moveToProject(d, id, el.value || null), "プロジェクトを付け替えました"); return; }
    if (f === "party") { apply((d) => updateTask(d, id, { waitingOn: { party: el.value, since: t.waitingOn?.since ?? today } }, today), "変更を保存しました"); return; }
    if (f === "repeat") {
      const r = el.value === "week" ? { unit: "week" } : el.value === "month" ? { unit: "month", day: Number(t.due.slice(8, 10)) } : null; // 毎月は、いまの期限の日にそろえる
      apply((d) => updateTask(d, id, { repeat: r }, today), "変更を保存しました");
      return;
    }
    if (f === "expected") { apply((d) => updateTask(d, id, { waitingOn: { party: t.waitingOn.party, since: t.waitingOn.since, expected: el.value } }, today), "変更を保存しました"); return; }
    if (f === "group" || f === "subgroup") S.hlId = id; // 該当グループへ移った行を強調して見失わないようにする
    apply((d) => updateTask(d, id, { [f]: f === "important" ? el.checked : el.value }, today), "変更を保存しました");
  }
}

/* ---------- ドラッグ&ドロップ(枠・会議の配置と移動) ---------- */
let ghost = null, drag = null;
const minAtEl = (y, el) => { const g = calendarGeometry(), r = el.getBoundingClientRect(); return g.h0 + ((y - r.top) / r.height) * g.span; };
const findSession = (id) => allSessions(S.data).find((s) => s.id === id);

/** ドロップ先の判定(データは変えない): { st, end, error?, warning, next, msg }。落とし先の読み取りだけここで行い、判断は dnd.js */
const planDrop = (dz, clientY) => planDropAt(S.data, drag, { date: dz.dataset.date, at: minAtEl(clientY, dz) }, clock());

/** ドラッグ中の時刻（10:00–11:00）を、ポインタの近くに出す。終わり・Esc・描き直しで消す */
function showTip(text, x, y) {
  let tip = document.getElementById("dragtip");
  if (!tip) { tip = document.createElement("div"); tip.id = "dragtip"; tip.setAttribute("aria-hidden", "true"); document.body.appendChild(tip); }
  tip.textContent = text;
  tip.style.left = `${x + 14}px`;
  tip.style.top = `${y + 14}px`;
}
function hideTip() { document.getElementById("dragtip")?.remove(); }

view.addEventListener("dragstart", (e) => {
  const tr = e.target.closest("[data-tdrag]"); // ToDo タブの候補の行 → 左の列へ落として「今日へ」。スケジュール画面のドラッグの判定には進まない
  if (tr) { drag = { kind: "today", id: tr.dataset.tdrag }; e.dataTransfer.setData("text/plain", drag.id); e.dataTransfer.effectAllowed = "copy"; return; }
  const ckm = e.target.closest("[data-ckmv]");
  if (ckm) { // チェックリストの項目の並べ替え（同じタスクの中だけ）
    drag = { kind: "ckorder", id: ckm.dataset.ckmv };
    e.dataTransfer.setDragImage(ckm.closest(".ck-row"), 12, 12);
    e.dataTransfer.setData("text/plain", drag.id);
    e.dataTransfer.effectAllowed = "move";
    return;
  }
  const li = e.target.closest("[data-dragtask]"), bl = e.target.closest("[data-dragsess]"), mg = e.target.closest("[data-dragmtg]"), mv = e.target.closest("[data-mvh]");
  drag = li ? { kind: "task", id: li.dataset.dragtask } : bl ? { kind: "sess", id: bl.dataset.dragsess } : mg ? { kind: "mtg", id: mg.dataset.dragmtg } : mv ? { kind: "order", id: mv.dataset.mvh } : null;
  if (!drag) return;
  if (mv) e.dataTransfer.setDragImage(mv.closest("tr,.g-label"), 12, 12); // 動かしているタスクの見た目にする（ガントは、横に長い行ではなくラベルだけ）
  e.dataTransfer.setData("text/plain", drag.id);
  e.dataTransfer.effectAllowed = "move";
});
/** タスクの並べ替え（リスト・ガントの「⠿」）。落とす位置の行を読み、判断は dnd.js。落とせない・動かないときは null */
function planOrder(e) {
  const row = e.target.closest?.("tr, .g-row");
  if (!row) return null;
  const info = (r) => { const s = r.matches("tr") ? r : r.querySelector(":scope > .g-label"); return s ? { id: s.dataset.mvrow, pid: s.dataset.mvgrp, g: s.dataset.mvg ?? "", sg: s.dataset.mvsg ?? "" } : {}; };
  const sibs = [...row.parentNode.children].filter((r) => r.matches("tr, .g-row"));
  const box = row.getBoundingClientRect();
  const plan = planOrderAt(S.data, drag.id, sibs.map(info), sibs.indexOf(row), e.clientY < box.top + box.height / 2);
  return plan && { ...plan, row };
}
/** チェックリストの項目の落とし先。落とす行を読み、判断は dnd.js。動かない・落とせないときは null */
function planCkOrder(e) {
  const row = e.target.closest?.(".ck-row");
  const box = row?.closest("[data-ckbox]");
  const [tid, iid] = drag.id.split("|");
  if (!row || box?.dataset.ckbox !== tid) return null;
  const rows = [...box.querySelectorAll(":scope > .ck-row")];
  const r = row.getBoundingClientRect();
  const plan = planCkOrderAt(S.data, tid, iid, rows.map((x) => x.dataset.ckid), rows.indexOf(row), e.clientY < r.top + r.height / 2);
  return plan && { tid, iid, ...plan, row };
}
const clearOrderLine = () => view.querySelectorAll(".drop-before,.drop-after").forEach((r) => r.classList.remove("drop-before", "drop-after"));
const clearTdDrop = () => view.querySelector("[data-tddrop].drop")?.classList.remove("drop");
view.addEventListener("dragover", (e) => {
  if (drag?.kind === "today") { // 左の列（今日の ToDo の列）の上だけ落とせる。上にいる間だけ強調する
    const z = e.target.closest("[data-tddrop]");
    view.querySelector("[data-tddrop]")?.classList.toggle("drop", !!z);
    if (z) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
    return;
  }
  if (drag?.kind === "ckorder") {
    const p = planCkOrder(e);
    clearOrderLine();
    if (!p) return;
    e.preventDefault();
    p.row.classList.add(p.pos === "before" ? "drop-before" : "drop-after");
    return;
  }
  if (drag?.kind === "order") {
    const p = planOrder(e);
    clearOrderLine();
    if (!p) return;
    e.preventDefault();
    p.row.classList.add(p.pos === "before" ? "drop-before" : "drop-after");
    return;
  }
  const dz = e.target.closest(".dz");
  if (!dz || !drag) return;
  e.preventDefault();
  const p = planDrop(dz, e.clientY), g = calendarGeometry();
  if (!ghost || !ghost.isConnected || ghost.parentNode !== dz) { ghost?.remove(); ghost = document.createElement("div"); ghost.className = "ghost"; dz.appendChild(ghost); }
  ghost.style.top = g.tp(p.st);
  ghost.style.height = g.ht(p.st, p.end);
  ghost.classList.toggle("ng", !!p.error);
  ghost.textContent = p.error ?? `${hm(p.st)}-${hm(p.end)}${p.warning ? `(${p.warning})` : ""}`;
  if (p.error) hideTip(); else showTip(`${hm(p.st)}–${hm(p.end)}`, e.clientX, e.clientY);
});
view.addEventListener("drop", (e) => {
  if (drag?.kind === "today") {
    e.preventDefault();
    const id = drag.id;
    clearTdDrop();
    drag = null;
    if (e.target.closest("[data-tddrop]")) openPlan(id);
    return;
  }
  if (drag?.kind === "ckorder") {
    e.preventDefault();
    const p = planCkOrder(e);
    clearOrderLine();
    drag = null;
    if (p) apply((d) => moveChecklistItem(d, p.tid, p.iid, p.beforeId));
    return;
  }
  if (drag?.kind === "order") {
    e.preventDefault();
    const p = planOrder(e), id = drag.id;
    clearOrderLine();
    drag = null;
    if (p) apply((d) => moveTask(d, id, { beforeId: p.beforeId, group: p.group, subgroup: p.subgroup }), "並べ替えました");
    return;
  }
  const dz = e.target.closest(".dz");
  if (!dz || !drag) return;
  e.preventDefault();
  const p = planDrop(dz, e.clientY);
  drag = null;
  ghost?.remove(); ghost = null;
  hideTip();
  if (p.error) { toast(p.error); return; }
  apply((d) => p.next(d), `${p.msg}${p.warning ? `(${p.warning})` : ""}`);
});
view.addEventListener("dragend", () => { clearOrderLine(); clearTdDrop(); drag = null; ghost?.remove(); ghost = null; hideTip(); });

/* ---------- 枠・手入力の会議の下端ドラッグ(終了時刻を変える) ---------- */
view.addEventListener("mousedown", (e) => {
  const h = e.target.closest("[data-rz],[data-rzm]");
  if (!h) return;
  e.preventDefault(); e.stopPropagation();
  const isMtg = h.dataset.rzm !== undefined, id = isMtg ? h.dataset.rzm : h.dataset.rz, blk = h.closest(".blk");
  blk.draggable = false; // つまみの操作中にブラウザ標準のドラッグが始まらないようにする
  const g = calendarGeometry();
  const rec = isMtg ? S.data.events.find((o) => o.id === id) : findSession(id);
  const a0 = Math.max(toMin(rec.start), g.h0);
  let end = null;
  const move = (ev) => {
    end = Math.min(LAST_END, Math.max(a0 + 15, Math.round(minAtEl(ev.clientY, blk.parentNode) / 15) * 15)); // 終了は 23:59 まで（24:00 は時刻に書けない）
    blk.style.height = g.ht(a0, end);
    showTip(`${hm(a0)}–${hm(end)}`, ev.clientX, ev.clientY);
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    hideTip();
    blk.draggable = true;
    if (end == null) return;
    const e2 = toHHMM(end);
    if (isMtg) apply((d) => updateMeeting(d, id, { end: e2 }), `会議「${rec.title}」の終了を ${hm(end)} に変更しました`);
    else {
      const at = clock();
      const r = resizeSession(S.data, id, e2, at);
      if (r.error) { toast(r.error); render(); } else apply(asEdit((d) => resizeSession(d, id, e2, at)), `終了を ${hm(end)} に変更しました${r.warning ? `(${r.warning})` : ""}`);
    }
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

/* ---------- 前のタスクの強調(バーにマウスを置いたとき) ---------- */
view.addEventListener("mouseover", (e) => {
  const bar = e.target.closest("[data-gt]");
  const gb = bar?.closest(".gbody");
  if (gb) focusDeps(gb, bar.dataset.gt);
});
view.addEventListener("mouseout", (e) => {
  const gb = e.target.closest("[data-gt]")?.closest(".gbody");
  if (gb) focusDeps(gb, null);
});

/* ---------- ガント上のドラッグで日付を変更(1日単位) ---------- */
view.addEventListener("mousedown", (e) => {
  const tg = e.target.closest("[data-gt],[data-gp],[data-gms]");
  if (!tg || !tg.closest(".gscroll")) return;
  const handle = e.target.closest("[data-gh]")?.dataset.gh ?? "m";
  document.activeElement?.closest?.("[data-tpop]") && document.activeElement.blur(); // 窓で打ちかけの入力を、preventDefault で捨てない（blur で change を起こして保存する）
  const sc = tg.closest(".gscroll"), lane = tg.closest(".g-lane");
  const total = +sc.dataset.span, s0 = sc.dataset.s0, ppd = lane.offsetWidth / total;
  const idx = (d) => diffDays(d, s0);
  let kind, t, p, mIdx, mode = handle, s, en, raw;
  if (tg.dataset.gt) {
    kind = "t"; t = S.data.tasks.find((x) => x.id === tg.dataset.gt);
    raw = idx(taskStart(S.data, t.id));
    en = idx(t.due); s = Math.min(raw, en); // 開始が期限より後のタスクは、描画と同じく期限の 1 日分の棒として扱う
    if (tg.classList.contains("dot") || (!t.start && raw > en)) mode = "r"; // 点（期限だけのタスク）と、開始日の指定がなく前のタスクの期限が期限より後のタスクは、期限だけが動く（開始日を足し引きすると、期限より後になるため）
  } else if (tg.dataset.gp) {
    kind = "p"; p = S.data.projects.find((x) => x.id === tg.dataset.gp);
    s = idx(p.start); en = idx(p.due);
    if (mode === "m") return;
  } else {
    kind = "m"; const [pid, i] = tg.dataset.gms.split("|");
    p = S.data.projects.find((x) => x.id === pid); mIdx = +i; s = en = idx(p.milestones[mIdx].date); mode = "r";
  }
  e.preventDefault();
  const gbody = tg.closest(".gbody");
  gbody?.classList.add("dep-hide"); // ドラッグ中は線がずれるので隠す(離したら戻す)
  const x0 = e.clientX;
  let dd = 0;
  const pct = (n) => `${((n / total) * 100).toFixed(3)}%`;
  // 右つまみ: 開始日の指定がなく、開始 ≥ 期限のタスク（点・前のタスクだけが頼りの帯）は、前のタスクの期限へ跳ばさず、そのまま動かす。それ以外は開始日より前へ動かさない
  const edges = (dd) => {
    if (mode === "l") return [Math.min(s + dd, en), en];
    if (mode === "r") {
      const free = kind === "m" || (kind === "t" && !t.start && s >= en);
      const ne = free ? en + dd : Math.max(en + dd, s);
      return [kind === "t" && free ? Math.min(raw, ne) : s, ne]; // 開始日の指定がないタスクは、保存後、前のタスクの期限（raw）から期限までの棒になる（期限が raw より前なら、期限の 1 日分）。プレビューも同じにする
    }
    return [s + dd, en + dd];
  };
  const move = (ev) => {
    dd = Math.round((ev.clientX - x0) / ppd);
    const [ns, ne] = edges(dd);
    const dot = tg.classList.contains("dot");
    if (kind === "m" || dot) tg.style.left = dot ? `calc(${pct(ne)} + ${pct(0.5)})` : pct(ne); // 点は日付マスの中央（描画と同じ）
    else { tg.style.left = pct(ns); tg.style.width = pct(ne - ns + 1); } // 期限日のマスを含める（描画と同じ）
    tg.title = `${fmtMD(addDays(s0, ns))}〜${fmtMD(addDays(s0, ne))}`;
  };
  const up = (ev) => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    gbody?.classList.remove("dep-hide");
    if (!dd) { if (kind === "t") openTaskPop(t.id, ev.clientX, ev.clientY); return; } // 動かさずに離した = クリック
    const [ns, ne] = edges(dd);
    let result, msg, dragEdit;
    if (kind === "t") {
      const m = mode === "l" ? "start" : mode === "r" ? "due" : "both";
      const amt = m === "start" ? ns - s : m === "due" ? ne - en : dd;
      result = moveTaskDates(S.data, t.id, m, amt);
      dragEdit = (d) => { const r = moveTaskDates(d, t.id, m, amt); if (r.error) throw new Error(r.error); return r.data; };
      msg = `${t.id}: ${fmtMD(addDays(s0, ns))}〜${fmtMD(addDays(s0, ne))}`;
    } else if (kind === "p") {
      const edge = mode === "l" ? "start" : "due", amt = mode === "l" ? ns - s : ne - en, pid = p.id;
      result = moveProjectDates(S.data, pid, edge, amt);
      dragEdit = asEdit((d) => moveProjectDates(d, pid, edge, amt));
      msg = `${p.name}: ${fmtMD(mode === "l" ? addDays(s0, ns) : p.start)}〜${fmtMD(mode === "r" ? addDays(s0, ne) : p.due)}`;
    } else {
      const pid = p.id;
      result = { data: moveMilestone(S.data, pid, mIdx, dd) };
      dragEdit = (d) => moveMilestone(d, pid, mIdx, dd);
      msg = `マイルストーン「${p.milestones[mIdx].name}」を ${fmtMD(addDays(s0, ne))} に変更しました`;
    }
    if (result.error) { toast(result.error); render(); return; }
    apply(dragEdit, msg);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

/* ---------- キーボード ---------- */
document.addEventListener("keydown", (e) => {
  const typing = e.target.matches?.("input,select,textarea") || !!e.target.closest?.("[data-tedit], .mtgform, .actform"); // 編集欄・入力欄のボタンでも、枠を消さない
  if ((e.key === "Delete" || e.key === "Backspace") && S.screen === "schedule" && (S.selSess || S.selMtg) && !typing) { e.preventDefault(); deleteSelected(); }
  if (e.key === "Escape" && S.tpop) { S.tpop = null; render(); return; }
  if (e.key === "Escape" && (S.screen === "schedule" || S.screen === "todo") && (S.selSess || S.selMtg || S.mtgDraft || S.urgentDraft || S.actAdd || S.taskEdit)) { clearSel(); render(); }
});
view.addEventListener("keydown", (e) => {
  // 日本語入力の変換確定の Enter(isComposing)では追加しない
  if (e.key === "Enter" && !e.isComposing && e.target.matches("[data-gadd]")) { e.preventDefault(); submitGAdd(e.target); return; }
  if (e.key === "Enter" && !e.isComposing && e.target.matches("[data-ug=\"title\"]")) { e.preventDefault(); submitUrgent(); return; }
  if (e.key === "Enter" && !e.isComposing && e.target.matches("[data-rnew]")) { e.preventDefault(); addRule(); return; }
  if (e.key === "Enter" && !e.isComposing && e.target.matches("[data-hnew],[data-hto],[data-hnote]")) { e.preventDefault(); addHolidayFromInput(); return; }
  if (e.key === "Enter" && !e.isComposing && e.target.matches("[data-wnew],[data-wnote]")) { e.preventDefault(); addWorkdayFromInput(); return; }
  if (e.key === "Escape" && e.target.matches("[data-gadd]")) { S.addAt = null; render(); return; }
  if (e.key === "Enter" && !e.isComposing && e.target.matches("[data-waitparty]")) { e.preventDefault(); submitWait(e.target.dataset.waitparty); return; }
});

/* ---------- Claude Code への依頼（画面下の帯） ---------- */
const nowIso = () => new Date().toISOString();

/** 打ちかけの入力（依頼・対象・返信・理由・原因）を S.ib に取り込む。描き直しで消さないため */
function captureBar() {
  const el = $("claudebar");
  const t = el.querySelector("[data-ib-text]");
  if (t) S.ib.text = t.value;
  const p = el.querySelector("[data-ib-project]");
  if (p) S.ib.projectId = p.value;
  for (const [attr, key] of [["data-ib-reply", "replies"], ["data-ib-reason", "reasons"], ["data-ib-cause", "causes"]]) {
    for (const x of el.querySelectorAll(`[${attr}]`)) S.ib[key][x.getAttribute(attr)] = x.value;
  }
}

/** 描き直しのあとに、フォーカスを戻す入力欄の特定（data-ib-text など。依頼ごとの欄は ID つき） */
function barSelector(a) {
  const d = a.dataset;
  if (d.ibText !== undefined) return "[data-ib-text]";
  if (d.ibProject !== undefined) return "[data-ib-project]";
  for (const k of ["ibReply", "ibReason", "ibCause"]) if (d[k] !== undefined) return `[data-${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${CSS.escape(d[k])}"]`;
  return null;
}

let barSig = "", composing = false, barDirty = false;
/** 帯を描く。中身（依頼・見ている印・開閉）が変わっていなければ描き直さない（入力中の文字・変換・スクロールを壊さない）。force は、入力欄を空にしたときなど */
function renderBar(force = false) {
  const el = $("claudebar");
  if (!S.data) { el.innerHTML = ""; barSig = ""; return; }
  if (composing) { barDirty = true; return; } // 日本語入力の変換中は、終わるまで待つ
  if (!force && barSignature() === barSig) return;
  captureBar();
  const a = document.activeElement;
  const keep = a && el.contains(a) ? { sel: barSelector(a), s: a.selectionStart, e: a.selectionEnd } : null;
  el.innerHTML = renderInboxBar(S.data, { ...S.ib, canWrite: store.hasFile, nowMs: Date.now() });
  barSig = barSignature();
  if (keep?.sel) {
    const n = el.querySelector(keep.sel);
    if (n) { n.focus(); try { n.setSelectionRange(keep.s, keep.e); } catch { /* 選択できない欄 */ } }
  }
}
const barSignature = () => JSON.stringify([S.data?.inbox?.requests, S.data?.projects, isWatching(S.data ?? {}, Date.now()), S.ib.open, store.hasFile]);

function sendRequest() {
  captureBar();
  const text = S.ib.text.trim();
  if (!text) { toast("依頼を入力してください"); return; }
  const projectId = S.ib.projectId || null, now = nowIso();
  if (apply((d) => submitRequest(d, { text, projectId, now }), "依頼を送りました。Claude Code が受け取ると、状態が変わります")) {
    $("claudebar").querySelector("[data-ib-text]").value = ""; //描き直しは、画面の入力欄の値を先に取り込むので、画面側も空にする
    S.ib.text = "";
    saveInboxDraft("");
    renderBar(true);
  }
}

function replyRequest(id) {
  captureBar();
  const text = (S.ib.replies[id] ?? "").trim();
  if (!text) { toast("返信を入力してください"); return; }
  const now = nowIso();
  if (apply((d) => replyToRequest(d, id, text, now), "返信しました")) { delete S.ib.replies[id]; renderBar(); }
}

/** 提案の承認。HTML 自身が、その場で適用して保存する。先に Claude Code が適用・却下していたら、何もしない。提案のあとにデータが変わっていたら、失敗にする */
function approveRequest(id) {
  captureBar();
  const req = getRequest(S.data, id);
  if (!req || req.status !== "proposed") { toast("この依頼は、すでに処理されています"); sync.pollInbox(true); return; }
  const reason = String(S.ib.reasons[id] ?? req.proposal.reason ?? "").trim();
  const cause = S.ib.causes[id] ?? req.proposal.cause ?? "その他";
  if (!reason) { toast("変更履歴に残す理由を入力してください"); return; }
  const today = clock().date, now = nowIso();
  const ok = apply((d) => approveEdit(d, id, { reason, cause, today, now }), null);
  if (!ok) return;
  const after = getRequest(S.data, id)?.status;
  toast(after === "applied" ? "反映しました" : "提案のあとにデータが変わったので、反映しませんでした。「もう一度提案してもらう」を押してください");
}

// Claude Code の更新（受け取り・提案・見ている印）を読み直す。帯が開いている、または処理中の依頼があるときは 4 秒ごと、そうでなければ 16 秒ごと
setInterval(() => sync.pollInbox(), 4000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync.pollInbox(true); });

$("claudebar").addEventListener("click", (e) => {
  const q = (sel) => e.target.closest(sel);
  if (q("[data-ib-toggle]")) { captureBar(); S.ib.open = !S.ib.open; if (S.ib.open && !S.ib.projectTouched && !S.ib.projectId && S.filter !== "all" && S.filter !== "none") S.ib.projectId = S.filter; renderBar(); if (S.ib.open) sync.pollInbox(true); return; }
  const ex = q("[data-ib-example]");
  if (ex) {
    captureBar();
    const t = ibExamples(S.data, S.ib.projectId || (S.filter !== "all" && S.filter !== "none" ? S.filter : ""), clock().date)[ex.dataset.ibExample] ?? "";
    S.ib.text = S.ib.text.trim() ? `${S.ib.text.replace(/\s+$/, "")}\n${t}` : t;
    saveInboxDraft(S.ib.text);
    $("claudebar").querySelector("[data-ib-text]").value = S.ib.text; // 描き直しは画面の入力欄の値を先に取り込むので、画面側にも入れる
    renderBar(true);
    $("claudebar").querySelector("[data-ib-text]").focus();
    return;
  }
  if (q("[data-ib-send]")) { sendRequest(); return; }
  const ap = q("[data-ib-approve]"); if (ap) { approveRequest(ap.dataset.ibApprove); return; }
  const rj = q("[data-ib-reject]"); if (rj) { const id = rj.dataset.ibReject, now = nowIso(); apply((d) => rejectRequest(d, id, now), "却下しました"); return; }
  const rs = q("[data-ib-replysend]"); if (rs) { replyRequest(rs.dataset.ibReplysend); return; }
  const rt = q("[data-ib-retry]"); if (rt) { const id = rt.dataset.ibRetry, now = nowIso(); apply((d) => retryRequest(d, id, now), "もう一度提案を頼みました"); }
});
$("claudebar").addEventListener("compositionstart", () => { composing = true; });
$("claudebar").addEventListener("compositionend", () => { composing = false; if (barDirty) { barDirty = false; renderBar(); } });
$("claudebar").addEventListener("input", (e) => {
  if (e.target.matches("[data-ib-text]")) { S.ib.text = e.target.value; saveInboxDraft(S.ib.text); }
});
$("claudebar").addEventListener("change", (e) => {
  if (e.target.matches("[data-ib-project]")) S.ib.projectTouched = true; // 利用者が選び直したら、画面の絞り込みで上書きしない
  if (e.target.matches("[data-ib-project],[data-ib-cause],[data-ib-reason],[data-ib-reply]")) captureBar();
});
$("claudebar").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  if (e.target.matches("[data-ib-reply]")) { e.preventDefault(); replyRequest(e.target.dataset.ibReply); }
  else if (e.target.matches("[data-ib-text]") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendRequest(); }
});

// チップの行はスクロールバーを出さないので、マウスの縦のホイールで横に動かせるようにする(横スワイプ・Shift + ホイールは、ブラウザが横に動かす)
view.addEventListener("wheel", (e) => {
  const row = e.target.closest(".chips-row");
  if (!row || row.scrollWidth <= row.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
  const atEnd = e.deltaY > 0 ? row.scrollLeft >= row.scrollWidth - row.clientWidth - 0.5 : row.scrollLeft <= 0;
  if (atEnd) return; // 行の端に着いていたら、ページのスクロールに任せる
  row.scrollLeft += e.deltaY;
  e.preventDefault();
}, { passive: false });
let depsQueued = false;
window.addEventListener("resize", () => {
  syncSticky();
  if (!depsQueued) { depsQueued = true; requestAnimationFrame(() => { depsQueued = false; drawAllDeps(); }); } // ウィンドウを引っ張る間、線は 1 フレームに 1 回だけ引き直す
});

render();
startup();
