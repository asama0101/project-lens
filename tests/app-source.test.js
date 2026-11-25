import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../plugins/project-lens/src/ui/app.js", import.meta.url), "utf8");
const stk = readFileSync(new URL("../plugins/project-lens/src/ui/sticky.js", import.meta.url), "utf8"); // 固定表示（日付軸・列見出しの複製、横スクロールのそろえ）

// 編集は、いまのデータへの差分として書く。決まった結果を返す編集（() => data）は、保存の競合のとき、最新のファイルに当て直すと、
// 他（Claude Code など）の更新を消してしまう。
test("app.js: apply の編集は、必ず引数のデータを受け取る（決まった結果を返す編集を持たない）", () => {
  assert.doesNotMatch(src, /apply\(\(\) =>/);
  assert.doesNotMatch(src, /applyFixed/);
  assert.doesNotMatch(src, /next: \(\) =>/);
});

test("app.js: 状態の変更は changeStatus に集める（リストの select・編集欄）。今日のタスクに着手・完了のボタンは無い", () => {
  assert.match(src, /function changeStatus\(/);
  const onChangeStatus = src.slice(src.indexOf('if (f === "status")'), src.indexOf('if (f === "party")'));
  assert.match(onChangeStatus, /changeStatus\(/);
  assert.ok(!src.includes("data-setstatus"), "今日のタスクの着手・完了のボタンは無い");
  assert.match(src, /const scheduleOpts = \(\) => \(\{[^\n]*pendingDone: S\.pendingDone/);
});

// リストでは select が確認の行の横に残るので、選び直したときに前の確認（Done の警告・待ち先の入力）が残ると、古い選択で Done・Waiting にできてしまう
test("app.js: changeStatus は、最初に pendingDone と pendingWait を外す（要るときだけ立て直す）", () => {
  const body = src.slice(src.indexOf("function changeStatus("), src.indexOf("function setStatus("));
  const first = body.split(/\r?\n/)[1].trim();
  assert.match(first, /^S\.pendingDone = null; S\.pendingWait = null;/);
});

test("app.js・index.html: 開始画面の案内、帯の対象の引き継ぎ、#toast の role", () => {
  assert.ok(!src.includes("data/sample.json"));
  assert.ok(src.includes("/project-lens:init") && src.includes(".project-lens/data.json"));
  assert.doesNotMatch(src, /pendingReplan|dueChange|replanAction/, "期限を変えたときの確認パネルは持たない（前後の確認は Claude Code に頼む）");
  const toggle = src.slice(src.indexOf('q("[data-ib-toggle]")'));
  assert.match(toggle.slice(0, 400), /!S\.ib\.projectId && S\.filter !== "all"[^\n]*S\.ib\.projectId = S\.filter/);
  const html = readFileSync(new URL("../plugins/project-lens/src/ui/index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="toast"[^>]*role="status"/);
});

test("app.js: 設定タブの data-set は updateSettings で保存し、data-rmove は moveProjectRule、focusSelector も data-set を扱う", () => {
  assert.match(src, /updateSettings\(/);
  assert.match(src, /moveProjectRule\(/);
  assert.match(src, /data-rmove/);
  const fs = src.slice(src.indexOf("function focusSelector"), src.indexOf("function focusSelector") + 900);
  assert.match(fs, /d\.set/);
});

test("app.js: 休みの追加（期間を含む）・区分の変更・削除と、営業日の指定の追加・削除は edit.js の関数を通る。期間は除外した日数を通知し、Enter でも追加する。focusSelector も新しい入力を扱う", () => {
  for (const f of ["addHoliday(", "addHolidayRange(", "holidayRangeDays(", "removeHoliday(", "addWorkday(", "removeWorkday("]) assert.ok(src.includes(f), f);
  for (const a of ["[data-hadd]", "[data-hdel]", "dataset.hrowkind", "[data-wadd]", "[data-wdel]"]) assert.ok(src.includes(a), a);
  assert.ok(src.includes('e.key === "Enter" && !e.isComposing && e.target.matches("[data-hnew],[data-hto],[data-hnote]")'));
  assert.ok(src.includes('e.key === "Enter" && !e.isComposing && e.target.matches("[data-wnew],[data-wnote]")'));
  assert.match(src, /除外/);
  assert.match(src, /日本の祝日は未取得/);
  const fs = src.slice(src.indexOf("function focusSelector"), src.indexOf("function focusSelector") + 1400);
  for (const k of ["hnew", "hto", "hnote", "wnew", "wnote"]) assert.ok(fs.includes(`"${k}"`), k);
});

test("schedule.js: カレンダー上部の確認（doneAsk）は無い（今日のタスクのパネルに移した）", () => {
  const sc = readFileSync(new URL("../plugins/project-lens/src/ui/views/schedule.js", import.meta.url), "utf8");
  assert.doesNotMatch(sc, /doneAsk/);
  assert.doesNotMatch(sc, /statusButtons/);
});

test("app.js: 枠のドラッグ・下端ドラッグの間、ポインタの近くに時刻（開始–終了）を出し、終わり・描き直しで消す", () => {
  assert.match(src, /function showTip\(/);
  assert.match(src, /function hideTip\(/);
  const over = src.slice(src.indexOf('view.addEventListener("dragover"'), src.indexOf('view.addEventListener("drop"'));
  assert.match(over, /showTip\(/, "dragover で更新");
  const end = src.slice(src.indexOf('view.addEventListener("drop"'), src.indexOf("/* ---------- 枠・手入力の会議の下端ドラッグ"));
  assert.match(end, /hideTip\(\)[\s\S]*dragend|dragend[\s\S]*hideTip\(\)/);
  assert.equal((end.match(/hideTip\(\)/g) ?? []).length >= 2, true, "drop と dragend の両方");
  const rz = src.slice(src.indexOf("/* ---------- 枠・手入力の会議の下端ドラッグ"), src.indexOf("/* ---------- ガント上のドラッグ"));
  assert.match(rz, /const move = [\s\S]*showTip\(/, "長さ変更中の更新");
  assert.match(rz, /const up = [\s\S]*hideTip\(\)/, "離したら消す");
  assert.match(src, /function render\(\) \{[^\n]*\n\s*hideTip\(\)/, "描き直しで消す");
});

test("app.js: 画面（タブ）を切り替えるとき、未来の予定枠の確認待ち（pendingDone）を捨てる（出す場所が無い画面で残らない）", () => {
  const tab = src.slice(src.indexOf("S.screen = b.id.slice(4);"), src.indexOf("S.screen = b.id.slice(4);") + 200);
  assert.match(tab, /S\.pendingDone = null/);
});

test("app.js: 「今日の優先」の取っ手を押すとき、パネル内にしか出ない確認待ち（pendingDone）を捨てる。取っ手は view のクリックで扱い、上部のバー（filebar）には prio のボタンがない（actual は残る）", () => {
  const pf = src.slice(src.indexOf("function togglePref"), src.indexOf("function togglePref") + 400);
  assert.match(pf, /S\.pendingDone = null/);
  assert.match(src, /view\.addEventListener\("click"[\s\S]*data-pref/);
  assert.doesNotMatch(src, /data-pref="prio" aria-pressed/);
  assert.match(src, /data-pref="actual" aria-pressed/);
});

test("app.js: 「参加しない会議」のボタン（data-sskip）は showSkipped を反転し、scheduleOpts に渡す。data-pref は持たない（右の列の取っ手・ガント実績と干渉しない）", () => {
  assert.match(src, /q\("\[data-sskip\]"\)\) \{ togglePref\("showSkipped"\)/);
  assert.match(src, /const scheduleOpts = \(\) => \(\{[^\n]*showSkipped: S\.prefs\.showSkipped/);
  const sc = readFileSync(new URL("../plugins/project-lens/src/ui/views/schedule.js", import.meta.url), "utf8");
  assert.doesNotMatch(sc, /data-sskip[^>]*data-pref|data-pref[^>]*data-sskip/);
});

test("schedule.js: ブロックの時刻は esc して出す（toMin が先に検証するが、描画側でも守る）", () => {
  const sc = readFileSync(new URL("../plugins/project-lens/src/ui/views/schedule.js", import.meta.url), "utf8");
  assert.match(sc, /\$\{esc\(m\.start\)\}-\$\{esc\(m\.end\)\}/);
  assert.match(sc, /\$\{esc\(t\.start\)\}-\$\{esc\(t\.end\)\}/); // 作業枠の時刻（t は枠自身か、実績のブロックの actual）
});

test("app.js: 営業日の指定の追加は、入力欄の値を先に取り出してから edit に入れる（保存の競合で当て直されても日付が空にならない）。終了日を入れたら同じ日でも期間として扱う", () => {
  const fn = src.slice(src.indexOf("function addWorkdayFromInput"), src.indexOf("function addWorkdayFromInput") + 600);
  assert.match(fn, /const date = view\.querySelector\("\[data-wnew\]"\)/);
  assert.match(fn, /const edit = \(d\) => addWorkday\(d, \{ date, note \}\)/);
  assert.match(src, /const range = to !== "";/);
});

test("app.js: 「解除して完了にする」を押したとき、確認を出した時点の枠のうち、いまもまだ開始していないものだけを解除する（確認から確定の間に始まった枠を消さない）", () => {
  const i = src.indexOf('const dk = q("[data-doneok]")');
  const ok = src.slice(i, i + 400);
  assert.match(ok, /pd\.future\.filter\(\(sid\) => futurePlanned\(S\.data, pd\.id, clock\(\)\)\.includes\(sid\)\)/);
});

test("app.js: 設定タブの入力の保存は、成功しても描き直さない（時刻は時・分を打つたびに change が起き、描き直すと入力の位置が「時」に戻って、続きが打てなくなる）。直した項目の古い注意だけ消す", () => {
  const fn = src.slice(src.indexOf("function changeSetting"), src.indexOf("function changeSetting") + 2000);
  assert.ok(fn.includes('apply(edit, "設定を保存しました", { quiet: true })'));
  assert.match(fn, /\.note\.err/);
});

test("app.js: 勤務時間（workday）の入力・保存待ちのタイマーを持たない", () => {
  for (const x of ["workday", "changeSettingSoon", "settingTimer", "DEFAULT_WORKDAY", "wdOf"]) assert.ok(!src.includes(x), x);
});

test("app.js: 設定タブの入力の保存後、古い注意を消すのは待ち長期化の日数だけ（呼び名は片方だけ直しても、もう片方の注意を残す）。呼び名は保存された値（空なら既定）を入力欄に出す", () => {
  const fn = src.slice(src.indexOf("function changeSetting(el)"), src.indexOf("function changeSetting(el)") + 1500);
  assert.match(fn, /k\.startsWith\("label-"\)/);
  assert.match(fn, /groupLabels\(S\.data\.settings\)/);
});

test("app.js: 設定タブの入力が不正なときは、描き直さず、入力欄を保存された値に戻す（描き直すとフォーカスが消える）", () => {
  const fn = src.slice(src.indexOf("function changeSetting(el)"), src.indexOf("function changeSetting(el)") + 2000);
  assert.match(fn, /try \{ edit\(S\.data\); \} catch \(e\) \{ toast\(e\.message\); restoreSettingInputs\(\); return; \}/);
  assert.match(src, /function restoreSettingInputs\(\)/);
  assert.match(src, /settingsInputValues\(S\.data\)/);
});

test("app.js: 状態を Done・Cancelled にしたとき、進行中の枠を残したことを知らせる", () => {
  const fn = src.slice(src.indexOf("function setStatus"), src.indexOf("function setStatus") + 1200);
  assert.match(fn, /runningPlanned\(S\.data, id, clock\(\)\)/);
  assert.ok(fn.includes("進行中の枠") && fn.includes("実績を入れます") && !fn.includes("実績にする"));
});

test("app.js: 帯の対象は、利用者が選び直したあとは、画面の絞り込みで上書きしない（「すべて」を選んだのに戻される）", () => {
  assert.match(src, /e\.target\.matches\("\[data-ib-project\]"\)\) S\.ib\.projectTouched = true/);
  assert.ok(src.includes('!S.ib.projectTouched && !S.ib.projectId && S.filter !== "all"'));
});

test("app.js: 設定タブの保存の編集は updateSettings(d, patch)。不正な入力の復元は、不正になりうる待ち長期化の日数だけ（呼び名は不正にならない）", () => {
  const fn = src.slice(src.indexOf("function changeSetting(el)"), src.indexOf("function changeSetting(el)") + 2000);
  assert.ok(fn.includes("const edit = (d) => updateSettings(d, patch);"));
  const rs = src.slice(src.indexOf("function restoreSettingInputs()"), src.indexOf("function restoreSettingInputs()") + 600);
  assert.ok(rs.includes('set("waitingLongDays"') && !rs.includes("workday"));
  assert.ok(!rs.includes("label-"));
});

test("app.js: 「土日祝を営業日に数える」のスイッチは、チェックの状態で保存し、描き直す（祝日・休みの節の説明を切り替えるため。quiet にしない）", () => {
  const fn = src.slice(src.indexOf("function changeSetting(el)"), src.indexOf("function changeSetting(el)") + 700);
  assert.match(fn, /k === "countWeekendsAndHolidays"/);
  assert.match(fn, /updateSettings\(d, \{ countWeekendsAndHolidays: el\.checked \}\)/);
  const line = fn.split("\n").find((l) => l.includes("countWeekendsAndHolidays: el.checked"));
  assert.doesNotMatch(line, /quiet/);
});

test("app.js: 休みの期間登録の通知は、土日祝を営業日に数える設定のとき、「日本の祝日は未取得のため、土日だけを除きました」を付けない（何も除いていない）", () => {
  const i = src.indexOf("holidayRangeDays(S.data, from, to)");
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 700), /countWeekendsAndHolidays/);
});

test("app.js: ガントのドラッグ中のバーの幅は、期限日のマスを含める（描画と同じ。ne - ns + 1 日）", () => {
  assert.match(src, /tg\.style\.left = pct\(ns\); tg\.style\.width = pct\(ne - ns \+ 1\);/);
});

test("index.html: タブは ガントチャート・リスト・スケジュール・ToDo・稼働・設定 の順で、「プロジェクト」はない", () => {
  const html = readFileSync(new URL("../plugins/project-lens/src/ui/index.html", import.meta.url), "utf8");
  const tabs = [...html.matchAll(/<button role="tab" id="tab-([a-z]+)"[^>]*>([^<]+)<\/button>/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(tabs, ["gantt:ガントチャート", "list:リスト", "schedule:スケジュール", "todo:ToDo", "workload:稼働", "settings:設定"]);
});

test("app.js: S.pview は廃止し、S.screen の初期値は gantt（リストへ移る操作は S.screen = \"list\"）", () => {
  assert.doesNotMatch(src, /pview/);
  assert.match(src, /screen: "gantt"/);
  assert.match(src, /S\.screen = "list"/);
});

test("app.js: 描き直しのあとに drawDeps を呼び、バーへの mouseover・mouseout で focusDeps を呼ぶ。ドラッグの開始で線を隠す", () => {
  assert.match(src, /syncSticky\(\);[\s\S]{0,200}drawAllDeps\(\)/);
  assert.match(src, /view\.addEventListener\("mouseover"[\s\S]{0,300}focusDeps\(/);
  assert.match(src, /view\.addEventListener\("mouseout"[\s\S]{0,300}focusDeps\(/);
  assert.match(src, /classList\.add\("dep-hide"\)/);
  assert.match(src, /window\.addEventListener\("resize"[\s\S]{0,120}drawAllDeps/);
});

test("app.js: resize は requestAnimationFrame で間引いて線を引き直す。取っ手は focusSelector で描き直しのあとも戻る。filebar は actual だけを扱う", () => {
  assert.match(src, /window\.addEventListener\("resize"[\s\S]{0,260}requestAnimationFrame/);
  assert.match(src, /function focusSelector[\s\S]*d\.pref[\s\S]*return `\[data-pref=/);
  assert.match(src, /if \(pf\) \{ togglePref\("showActual"\); return; \}/);
});

test("画面の文言: 「プロジェクト」タブはないので、稼働・ガントチャートの案内に「プロジェクト画面」「リスト表示で」を使わない", () => {
  const wl = readFileSync(new URL("../plugins/project-lens/src/ui/views/workload.js", import.meta.url), "utf8");
  const gt = readFileSync(new URL("../plugins/project-lens/src/ui/views/gantt.js", import.meta.url), "utf8");
  assert.doesNotMatch(wl, /プロジェクト画面から/);
  assert.doesNotMatch(gt, /リスト表示で追加/);
});

test("app.js: 右の列を開け閉めすると、ガントの幅が変わるので、横スクロールを今日の位置へ戻す（resetScroll）", () => {
  const f = src.slice(src.indexOf("function togglePref"), src.indexOf("function togglePref") + 500);
  assert.match(f, /key === "showPrio"[^\n]*S\.resetScroll = true/);
});

test("app.js: 設定タブの節の開閉は、toggle イベント（バブリングしないのでキャプチャ）で S.settingsClosed に記録して保存する。開閉では描き直さない", () => {
  assert.match(src, /settingsClosed: loadSettingsClosed\(\)/);
  assert.match(src, /renderSettings\(S\.data, today, \{ ruleError: S\.ruleError, closed: S\.settingsClosed \}\)/);
  const i = src.indexOf('view.addEventListener("toggle"');
  assert.ok(i > 0);
  const fn = src.slice(i, i + 450);
  assert.match(fn, /matches\("details\[data-fold\]"\)/);
  assert.match(fn, /saveSettingsClosed\(/);
  assert.doesNotMatch(fn, /render\(\)/);
  assert.match(fn, /\}, true\);/, "キャプチャ");
});

// ---- 固定表示（ガント）: 画面のスクロールに対して、CSS の sticky で付ける ----
const css = readFileSync(new URL("../plugins/project-lens/src/ui/theme.css", import.meta.url), "utf8");

test("theme.css: ガントの固定表示の規則は #view の中だけ。見出し（.pgstick）は画面の縦スクロールに sticky、枠は横だけにスクロールする", () => {
  assert.match(css, /#view \.pgstick\{[^}]*position:sticky[^}]*top:calc\(var\(--hh,0px\) \+ var\(--th,0px\) \+ var\(--gh,0px\)\)/);
  assert.match(css, /#view \.gscroll\{[^}]*overflow-x:auto[^}]*overflow-y:hidden/);
  assert.doesNotMatch(css, /max-height:calc\(100vh - var\(--gsy/, "枠の高さを決める規則は持たない");
  assert.doesNotMatch(css, /--sbw|--gsy/, "枠の縦スクロールバーに合わせる変数は持たない");
  assert.match(css, /#view\{overflow-anchor:none\}/, "描き直しで縦の位置がずれないよう、スクロールアンカーを切る（実測: 切らないと 1 回の描き直しで +2px）");
});

test("app.js: pinTableHeads は日付軸（.g-head）をずらさない。syncSticky が --gh・--pgh を入れる（--ibh・--gt・--gsy・--sbw は使わない）", () => {
  const fn = stk.slice(stk.indexOf("function pinTableHeads"), stk.indexOf("let pinQueued"));
  assert.ok(fn.length > 50, "pinTableHeads を切り出せた");
  assert.doesNotMatch(fn, /g-head/);
  for (const v of ["--gh", "--pgh"]) assert.ok(stk.includes(`setProperty("${v}"`), `${v} を入れる`);
  for (const v of ["--gsy", "--sbw", "--ibh"]) assert.ok(!stk.includes(v), `${v} はもう使わない`);
});

test("app.js: 描き直しで、ガントの横のスクロール位置（scrollLeft）とページの縦の位置（scrollY）を保って戻す。全 .gscroll の横位置は alignGScrolls でそろえる", () => {
  const fn = src.slice(src.indexOf("function render()"), src.indexOf("function scrollToday"));
  assert.match(fn, /scrollLeft/);
  assert.match(fn, /window\.scrollY/);
  assert.match(fn, /window\.scrollTo\(0, /);
  assert.match(fn, /view\.style\.minHeight/, "描き直しの間、ページが縮んで scrollY が飛ばないようにする");
  assert.doesNotMatch(fn, /scrollTop/, "枠は縦にスクロールしない");
  const al = stk.slice(stk.indexOf("function alignGScrolls"), stk.indexOf("function alignGScrolls") + 600);
  assert.match(al, /scrollLeft - /, "差があるときだけ代入する（ループしない）");
  assert.match(stk, /classList\.contains\("gscroll"\)\) return;\s+if \(aligned\.get\(gs\) === gs\.scrollLeft\)/, "そろえたときに起きる scroll は、そろえ直さない（動いている枠を引き戻さない）");
  assert.match(stk, /aligned\.set\(gs, gs\.scrollLeft\)/);
  assert.match(stk, /\}, true\);/, "scroll はバブルしないので、キャプチャで受ける");
});

// ---- 固定表示（リスト）: 名前・状態の行の中の、列見出しの複製 ----
test("app.js: リストの列見出しは、表を包む枠（.twrap）の先頭の複製（.thstrip）で固定する。複製は aria-hidden、横スクロールは translateX でそろえる。出す・隠すの JS（thStripOn・updateThStrips）は持たない", () => {
  assert.ok(stk.includes('className = "thin"') && stk.includes('className = "thc"'), "複製の中身(列の並び)を作る。複製の入れ物(.thstrip)は、renderList が aria-hidden つきで出す");
  assert.match(stk, /translateX\(\$\{-box\.scrollLeft\}px\)/);
  assert.ok(!(src + stk).includes("thStripOn") && !(src + stk).includes("updateThStrips"), "固定していないときは本物の thead に重なるので、出し分けは要らない");
  assert.ok(!stk.includes("is-scroll") && !stk.includes("--pst"), "表を横スクロールの枠にする案の名残がない");
  const pin = stk.slice(stk.indexOf("function pinTableHeads"), stk.indexOf("let pinQueued"));
  assert.match(pin, /classList\.contains\("tlist"\)\) continue/, "リストの表は pinTableHeads の対象外");
});

test("theme.css: 列見出しの複製の規則は #view の中だけ。複製は表の枠（.twrap）の中の sticky で、--ph（固定の行の高さ）の下に付く。リストの表を sticky・横スクロールの枠にする規則は持たない", () => {
  for (const rule of ["#view .pstick{position:sticky;top:calc(var(--hh,0px) + var(--th,0px))", "#view .pstick .prow{display:flex", "#view .pstick .phead{margin:", "#view .thstrip{position:sticky;top:calc(var(--hh,0px) + var(--th,0px) + var(--ph,0px))", "#view .twrap{padding-bottom:calc(var(--sh,0px) + var(--sb,0px))}", "#view .twrap > .tscroll{margin-bottom:calc(-1 * (var(--sh,0px) + var(--sb,0px)))}", "#view .thstrip .thin{display:flex"]) assert.ok(css.includes(rule), rule);
  assert.ok(!css.includes("#view .thstrip.on") && !css.includes("position:absolute;top:100%"), "出し分け（.on）と絶対配置は持たない");
  assert.ok(!css.includes("is-scroll") && !css.includes(".tscroll.tlist"), "表を枠にする規則の名残がない");
});

// ---- 固定表示の見直し（ブランチ全体のレビューの指摘） ----
test("app.js: --gt は使わない（ガントの枠の高さを決める変数は、もう持たない）", () => {
  assert.ok(!stk.includes('setProperty("--gt"'), "--gt はもう使わない");
  assert.doesNotMatch(css, /--gt/);
});

test("app.js: 下の帯の高さ（syncIbh・--ibh）は、ガントの枠の高さを決めなくなったので持たない", () => {
  assert.ok(!src.includes("syncIbh") && !src.includes("--ibh"));
  assert.doesNotMatch(css, /--ibh/);
});

test("app.js: 複製は .twrap の子で、syncThStrips が --ph（固定の行の高さ）と --sh（複製の高さ）を入れる", () => {
  assert.ok(stk.includes('wrap?.querySelector(":scope > .thstrip")'),"複製は .twrap の先頭の子（sticky の基準）");
  const start = stk.indexOf("function syncThStrips");
  const fn = stk.slice(start, stk.indexOf("\n}\n", start));
  assert.match(fn, /setProperty\("--ph"/);
  assert.match(fn, /setProperty\("--sh"/);
  assert.doesNotMatch(fn, /appendChild\(strip\)/, "固定の行の子にしない");
});


// ---- ページの先頭でも、固定の行が、固定したときと同じ位置にある（スクロールの始めに、固定の行が動かない） ----
test("theme.css: ヘッダーは、どの画面でも、ページの先頭で固定したときと同じ位置（上端 0）にある（body の上の余白 8px = ヘッダーの負の margin）。ガント・リスト（.ptool がある画面）では、ヘッダーとフィルタ行の間も詰める", () => {
  assert.ok(css.includes("body{padding-block:8px 76px}") && !css.includes("padding-block:16px 76px"), "body の上の余白は、どの画面でも 8px（下は依頼の帯の分）");
  assert.ok(css.includes("header.top{position:sticky;top:0;z-index:20;background:var(--bg);padding:8px 0;margin-block:-8px 0}"));
  assert.ok(!css.includes("body:has(.ptool)"), "画面ごとに余白を変えない");
  for (const rule of [
    ".wrap:has(.ptool),.wrap:has(.stop){gap:0}",
    "#banner:not(:empty){margin-block:8px}",
    "#view section.panel:has(> .gtop),#view section.panel:has(> .pstick),#view section.panel:has(> .stop){padding-top:0}",
    "#view section.panel > .pstick{padding-top:20px}",
    "#view section.panel > .gtop{padding-top:22px}",
    "#view .cols>.side,#view .side-toggle{margin-top:8px}",
  ]) assert.ok(css.includes(rule), rule);
  const section = css.slice(css.indexOf("/* ページの先頭でも"));
  assert.ok(section.length > 100, "節がある");
  assert.ok(!section.includes("border-top-width:0") && !section.includes("border-top-left-radius:0"), "カードの上端の線と角丸は消さない");
  for (const line of section.split(/\r?\n/).filter((l) => l.includes("{") && !l.startsWith("/*"))) assert.match(line, /^(\.wrap:has\(\.ptool\)|#banner|#view)/, line);
});

test("theme.css: ガントは、リストと同じく、プロジェクトごとに 1 枚のカード（section.pg）に分け、カードの間を 16px 空ける。操作の帯（.gtop）も 1 枚のカード。外側の panel は枠を持たず、.gtop の sticky の範囲としてだけ残す", () => {
  for (const rule of [
    "#view section.panel:has(> .gtop){background:none;border:0;border-radius:0;padding:0}",
    "#view section.panel > .gtop{padding-inline:16px;margin-bottom:16px;background:var(--surface);border:1px solid var(--line);border-radius:10px}",
    "#view section.pg{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:0 16px 16px}",
    "#view section.pg + section.pg{margin-top:16px}",
    "#view section.pg > .pgstick{padding-top:18px}",
  ]) assert.ok(css.includes(rule), rule);
});

test("theme.css: スケジュールの編集欄の詳細は、全幅の別の入れ物（.tedit-detail）で折り返す。開閉のボタンは長い方の文字の幅を最小にし、欄のスクロールバーの分の幅を常に取る（詳細の開閉で軽い欄が動かない）", () => {
  for (const rule of [
    "#view .tedit .tedit-detail{flex-basis:100%;display:flex;flex-wrap:wrap;",
    "#view .tedit [data-tedit-full]{min-width:calc(6em + 26px)}",
    "#view #mtgslot:not(:empty){scrollbar-gutter:stable}",
  ]) assert.ok(css.includes(rule), rule);
});

// ---- 固定表示（ガント）: 日付軸の複製（.gstrip）----
test("app.js: 日付軸の複製（.gstrip）を syncSticky が作り直し、alignGScrolls が複製の横位置（translateX）を更新する", () => {
  assert.ok(stk.includes("function syncGStrips") && stk.includes("function updateGStrip"));
  const sync = stk.slice(stk.indexOf("function syncSticky"), stk.indexOf("function syncThStrips"));
  assert.match(sync, /syncGStrips\(\)/);
  const upd = stk.slice(stk.indexOf("function updateGStrip"), stk.indexOf("function updateGStrip") + 500);
  assert.match(upd, /translateX\(\$\{-gs\.scrollLeft\}px\)/);
  const al = stk.slice(stk.indexOf("function alignGScrolls"), stk.indexOf("const aligned = new WeakMap"));
  assert.match(al, /updateGStrip\(/, "そろえた枠の複製も動かす");
  assert.ok(stk.includes('className = "gsl"') && stk.includes('className = "gsv"'), "複製は、左の空き(.gsl)と窓(.gsv)の 2 つ");
  assert.match(stk, /\.g-head \.g-lane/, "本物の日付軸の行を写す");
  assert.match(stk, /removeAttribute\("id"\)/, "複製の中の id は外す（重複を避ける）");
});

test("theme.css: .gstrip は sticky で、top に --pgh を含み、複製の窓は本物の幅で隠す", () => {
  assert.match(css, /#view \.gstrip\{[^}]*position:sticky[^}]*top:calc\(var\(--hh,0px\) \+ var\(--th,0px\) \+ var\(--gh,0px\) \+ var\(--pgh,0px\)\)[^}]*display:flex/);
  assert.match(css, /#view \.gstrip \.gsl\{[^}]*width:var\(--lw\)/);
  assert.ok(css.includes("#view .gwrap{padding-bottom:calc(var(--sh,0px) + var(--sb,0px))}") && css.includes("#view .gwrap > .gscroll{margin-bottom:calc(-1 * (var(--sh,0px) + var(--sb,0px)))}"), "横スクロールバーの高さ(--sb)も、sticky の範囲から除く（複製が表・枠のスクロールバーに重ならない）");
  assert.ok(stk.includes('setProperty("--sb"'), "syncGStrips・syncThStrips が --sb を入れる");
  assert.match(css, /#view \.gstrip \.gsv\{[^}]*overflow:hidden/);
});

// ---- 絞り込みチップ: 1 行に収めて、横にスクロールする ----
test("theme.css: チップの行は折り返さず横にスクロールし、プロジェクト名のプルダウン・追加ボタンは固定のまま", () => {
  assert.match(css, /#view \.ptool\{[^}]*display:flex[^}]*flex-wrap:nowrap/);
  assert.match(css, /#view \.ptool \.chips-row\{[^}]*display:flex[^}]*flex-wrap:nowrap[^}]*overflow-x:auto[^}]*min-width:0/);
  assert.match(css, /#view \.ptool \.chips-row \.chip-btn\{[^}]*flex:none/);
  assert.match(css, /#view \.ptool \.ptool-end\{[^}]*flex:none/);
});

test("app.js: 描き直しで、チップの行の横位置を保ち、選択中のチップが見えなければ行の中だけを動かす（scrollIntoView は使わない: ページの縦が動くため）", () => {
  const fn = src.slice(src.indexOf("function render()"), src.indexOf("function focusSelector"));
  assert.match(fn, /\.chips-row/);
  assert.match(fn, /chipsLeft/);
  assert.doesNotMatch(fn, /scrollIntoView\(\{ block: "nearest"/, "ページの縦を動かす scrollIntoView を、チップに使わない");
  assert.match(fn, /aria-pressed="true"/);
});

test("チップの行はスクロールバーを出さず（高さが 5 件のときと同じ）、縦のホイールで横に動く", () => {
  assert.match(css, /#view \.ptool \.chips-row\{[^}]*scrollbar-width:none/);
  assert.match(css, /#view \.ptool \.chips-row::-webkit-scrollbar\{display:none\}/);
  const w = src.slice(src.indexOf('closest(".chips-row")') - 200, src.indexOf('closest(".chips-row")') + 500);
  assert.match(w, /addEventListener\("wheel"/);
  assert.match(w, /row\.scrollLeft \+= e\.deltaY/);
  assert.match(w, /passive: false/);
});

test("theme.css: 日付軸の複製（.gstrip、z-index:6）は、本物の日付軸（.g-head、z-index:5）より上に描く（同じ値だと、境目で本物が複製の上に描かれ、目盛りが見出しの下へ滑り込む。実測）", () => {
  assert.match(css, /#view \.g-head\{[^}]*z-index:5/);
  assert.match(css, /#view \.gstrip\{[^}]*z-index:6/);
});

test("app.js: alignGScrolls は、代入で値が変わったときだけ aligned に記録する（右端で丸められて変わらないとき、古い値が残って、あとの本物のスクロールを飲み込まない）", () => {
  const al = stk.slice(stk.indexOf("function alignGScrolls"), stk.indexOf("const aligned = new WeakMap"));
  assert.match(al, /const before = gs\.scrollLeft/);
  assert.match(al, /if \(gs\.scrollLeft !== before\) aligned\.set\(gs, gs\.scrollLeft\)/);
});

test("app.js: チップの行のホイールは、行の端に着いていたら素通しにする（ページが動かなくなる罠にしない）", () => {
  const w = src.slice(src.indexOf('closest(".chips-row")') - 100, src.indexOf('closest(".chips-row")') + 700);
  assert.match(w, /scrollWidth - row\.clientWidth/);
  assert.match(w, /row\.scrollLeft <= 0/);
});

test("app.js: プロジェクト名のプルダウン（data-projectpick）で絞り込む。大項目の絞り込み（S.group・data-groupfilter）はもう持たない", () => {
  assert.match(src, /el\.dataset\.projectpick !== undefined\) \{ S\.filter = el\.value; S\.resetScroll = true; render\(\); return; \}/);
  assert.ok(!src.includes("S.group") && !src.includes("groupfilter") && !src.includes("group: \"all\""), "大項目の絞り込みの状態を持たない");
});

// チェックリストの編集欄のイベントは、Task 6 の属性（data-ck*）を読んで、edit.js の関数に載せる（動作は実ブラウザで確認する）
test("app.js: チェックリストの編集欄のイベントをつなぐ（開閉・チェック・文言・削除・追加・並び替え）。変換確定の Enter では追加しない", () => {
  for (const a of ["[data-cktoggle]", "dataset.ckdone", "dataset.cktext", "[data-ckdel]", "[data-ckadd]", "[data-ckmv]"]) assert.ok(src.includes(a), a);
  for (const f of ["addChecklistItem", "updateChecklistItem", "removeChecklistItem", "moveChecklistItem"]) assert.ok(src.includes(f), f);
  assert.match(src, /e\.isComposing/);
  assert.match(src, /checkOpen: S\.checkOpen/, "リストの展開の状態を描画に渡す");
  assert.match(src, /S\.checkOpen = new Set\(\)/);
});

test("app.js: 「詳細」の開閉は S.detailOpen。描画へ渡し、ファイルを開いたら空にする", () => {
  assert.ok(src.includes("[data-detailtoggle]"));
  assert.match(src, /S\.detailOpen\.has\(id\)/);
  assert.match(src, /detailOpen: S\.detailOpen/);
  assert.match(src, /S\.detailOpen = new Set\(\)/);
  assert.ok(src.includes("d.detailtoggle"), "描き直しのあと、フォーカスを戻す");
});

// ---- 全体レビューの修正（M1・M3・M4） ----

test("focusSelector: チェックリストのチェック・削除・展開ボタンも、描き直しのあとにフォーカスを戻せる（キーボードで操作しても位置を見失わない）", () => {
  const fn = src.slice(src.indexOf("function focusSelector("), src.indexOf("function focusSelector(") + 1600);
  for (const k of ["d.ckdone", "d.ckdel", "d.cktoggle"]) assert.ok(fn.includes(k), k);
});

test("theme.css: 画面のガントのラベル（⠿・ID・名前・×の 4 列）では、チェックリストの線を名前の列（3 列目）に置く", () => {
  assert.match(css, /\.g-label\[data-mvrow\] \.ck-meter\{grid-column:3\/-1\}/);
});

test("theme.css: 幅 860px 以下で、リストのチェックリストの展開行（.ck-tr）は全幅にする", () => {
  assert.match(css, /\.tbl\.edit tr\.ck-tr>td\{grid-column:1\/-1;padding-left:0\}/);
});

test("theme.css: リストの状態の欄は、In Progress・Cancelled が切れない最小幅を持つ。確認の行（.askrow）は、860px 以下でも全幅", () => {
  const m = css.match(/\.tbl\.edit td\[data-l="状態"\] select\{min-width:([\d.]+)em\}/);
  assert.ok(m && Number(m[1]) >= 9, m?.[0]);
  const narrow = css.slice(css.search(/@media\(max-width:860px\)\{\r?\n {2}\.tbl\.edit thead/));
  assert.match(narrow.slice(0, narrow.search(/\r?\n\}/)), /\.tbl\.edit tr\.askrow>td\{grid-column:1\/-1\}/);
  // 確認の行は表の全幅なので、中身（.askwrap）を、横スクロールの表示中の範囲の左端に付け、枠の幅に収める（左端に置くと、右へスクロールしたとき画面の外に出る）
  assert.ok(css.includes("#view .twrap > .tscroll{container-type:inline-size}"));
  assert.match(css, /\.tbl\.edit tr\.askrow \.askwrap\{position:sticky;left:0;width:max-content;max-width:min\(60em,100cqw - 16px\)\}/);
});

test("app.js: リストの確認の行（askrow）の中のクリックで、待ち先・Done の確認（pendingWait・pendingDone）を捨てない。捨てるのは、やめる・確定・タブの切り替え・取っ手だけ", () => {
  const clicks = src.slice(src.indexOf('view.addEventListener("click"'));
  const body = clicks.slice(0, clicks.search(/\r?\n\}\);/));
  assert.deepEqual(body.match(/S\.pendingWait = null[^\r\n]*/g), ['S.pendingWait = null; render(); return; }']);
  assert.ok(body.includes('if (q("[data-waitno]")) { S.pendingWait = null;'), "やめる（data-waitno）だけが待ち先の入力を閉じる");
  // 画面の外のクリック（キャプチャ段階）は、待ち先・Done の確認に触れない
  const outside = src.slice(src.indexOf('document.addEventListener("click", (e) => {'));
  assert.ok(!outside.slice(0, outside.indexOf("}, true);")).includes("pending"));
  // 行の並べ替え（ドラッグ）は、data-mvrow の行だけを対象にする（askrow には data-mvrow を付けない）
  assert.match(src, /s\.dataset\.mvrow/);
});

test("app.js: 日付の欄（data-date）は、キャプチャ段階の change で parseDateInput により YYYY-MM-DD に直し、読めないときは元の値に戻して通知し、ほかの処理に渡さない。Enter の確定も先に直す。「📅」は showPicker（使えないときは focus・click）", () => {
  const fn = src.slice(src.indexOf("function normalizeDateField(el)"), src.indexOf("function normalizeDateField(el)") + 600);
  assert.ok(fn.includes("parseDateInput(v)") && fn.includes("el.value = iso") && fn.includes("el.value = el.defaultValue") && fn.includes("日付は 2026/10/20 の形で入力してください"), fn);
  assert.match(src, /if \(el\.matches\?\.\("\[data-date\]"\) && !normalizeDateField\(el\)\) e\.stopImmediatePropagation\(\);\r?\n\}, true\);/);
  assert.match(src, /if \(!normalizeDateField\(e\.target\)\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\(\); \}\r?\n\}, true\);/);
  assert.ok(src.includes("try { pick.showPicker(); } catch { pick.focus(); pick.click(); }"));
  assert.ok(src.includes('field.dispatchEvent(new Event("change", { bubbles: true }))'), "選んだ日は、文字の欄の change として流す");
  assert.ok(src.indexOf("function normalizeDateField") < src.indexOf('view.addEventListener("change", (e) => { const el = e.target; setTimeout(() => onChange(el), 0); });'), "ほかの change の処理より前に登録する");
  assert.ok(!src.includes("validity.badInput"), "日付の欄の部分入力の判定は持たない（文字の欄のため）");
});

test("app.js: 突発タスクの入力欄は、ヘッダーのボタンからだけ開く（空き時間を押す経路 data-free・data-freedate を持たない）。addUrgentTask で確定し、Enter は変換確定中は確定しない", () => {
  for (const s of ["data-free", "freedate", "snapFreeStart"]) assert.ok(!src.includes(s), s);
  assert.ok(src.includes("addUrgentTask(d,"));
  assert.ok(src.includes('e.key === "Enter" && !e.isComposing && e.target.matches("[data-ug=\\"title\\"]")'));
  assert.match(src, /e\.key === "Escape" && \(S\.screen === "schedule" \|\| S\.screen === "todo"\) && \([^)]*S\.urgentDraft/);
});

test("app.js: タスクを押して選ぶ状態（S.picked・data-pick・body.picking）を持たない。右の列の行は data-dragtask でドラッグする", () => {
  for (const s of ["picked", "data-pick]", "dataset.pick", "picking"]) assert.ok(!src.includes(s), s);
  assert.ok(src.includes('e.target.closest("[data-dragtask]")'));
  assert.ok(!css.includes("picked") && !css.includes("picking") && !css.includes("data-pick"), "theme.css にも残さない");
});

test("app.js・theme.css: ヘッダーの「＋ 突発タスク」は、塗りの強調ボタン（btn primary）。hover でも文字が背景と同じ色にならない。暗い配色でも読める文字色", () => {
  assert.ok(src.includes('<button class="btn primary" data-urgent-open'));
  const rule = (sel) => css.slice(css.indexOf(sel + "{"), css.indexOf("}", css.indexOf(sel + "{")));
  assert.ok(rule(".btn.primary").includes("background:var(--accent)") && rule(".btn.primary").includes("color:var(--on-accent)"), rule(".btn.primary"));
  assert.ok(rule(".btn.primary:hover,.btn.primary:focus-visible").includes("color:var(--on-accent)"), "hover の .btn:hover（文字が accent）で、塗りと文字が同じ色にならない");
  assert.equal(css.split("--on-accent:").length - 1, 3, "明るい配色と、暗い配色の 2 か所");
});

test("theme.css: 週表示の今日の列は背景色を持たず、上端の線（--accent）だけで示す", () => {
  const rule = (sel) => css.slice(css.indexOf(sel + "{"), css.indexOf("}", css.indexOf(sel + "{")));
  const today = rule(".week .col.today");
  assert.ok(!today.includes("background") && today.includes("inset 0 5px 0 var(--accent)"), today);
  assert.ok(!css.includes("--today-col"));
});

test("theme.css: 空き時間のボタン（button.free）と凡例の空き時間（.sw.free）の規則を持たない", () => {
  assert.ok(!css.includes("button.free") && !css.includes(".sw.free"));
});

test("theme.css: 重要のバッジは 12px の太字、角の丸い帯（pill）", () => {
  const r = css.slice(css.indexOf("#view .impbadge{"), css.indexOf("}", css.indexOf("#view .impbadge{")));
  for (const s of ["font-size:12px", "font-weight:700", "border-radius:999px", "padding:2px 9px"]) assert.ok(r.includes(s), s);
});

test("app.js: ヘッダーの「＋ 突発タスク」は、clearSel() で選択を外し、スケジュール画面へ移り、urgentDefaultStart で開始を決めて件名にフォーカスする", () => {
  assert.ok(src.includes("data-urgent-open") && src.includes("＋ 突発タスク"));
  const body = src.slice(src.indexOf("function openUrgent()"), src.indexOf('$("filebar").addEventListener("click"'));
  assert.match(body, /clearSel\(\)/);
  assert.match(body, /S\.screen = "schedule"/);
  assert.match(body, /urgentDefaultStart\(date, clock\(\)\)/);
  assert.match(body, /\[data-ug="title"\]'?\)?\??\.focus/);
});

// ---- 2 ファイル（共有・個人）を開く ----
test("app.js: 画面は createPairStore で 2 つのファイルを開く。開始画面は、足りない方を選ぶボタン（data-open=\"shared\"・\"personal\"）と案内を出す", () => {
  assert.match(src, /const store = createPairStore\(\);/);
  assert.ok(!src.includes("createStore("), "1 ファイルのストアは使わない");
  assert.ok(src.includes('data-open="shared"') && src.includes('data-open="personal"'));
  assert.ok(src.includes("共有ファイルを選んでください") && src.includes("個人ファイルを選んでください"));
  const ss = src.slice(src.indexOf("function startScreen"), src.indexOf("const scheduleOpts"));
  assert.match(ss, /store\.missing\(\)/, "案内は、足りない方だけ");
  assert.match(ss, /data-reopen/);
  assert.match(ss, /S\.last\?\.\[w\]\?\.name/, "前回のファイルを開くは、足りない方に記憶があるときだけ");
  assert.ok(!src.includes("data-openfile"), "「別のファイルを開く」の 1 つのボタンは持たない");
});

test("app.js: ファイルを選ぶと store.choose(which)。2 つ揃ったら（データが返ったら）loaded、揃わなければ開始画面のまま", () => {
  const fn = src.slice(src.indexOf("async function openFile"), src.indexOf("async function startup"));
  assert.match(fn, /store\.choose\(which\)/);
  assert.match(fn, /if \(data\) \{ loaded\(data\);/);
  const vc = src.slice(src.indexOf('if (q("[data-reopen]"))'), src.indexOf("/* プロジェクト画面 */"));
  assert.match(vc, /!S\.data && q\("\[data-open\]"\)/, "開始画面のボタンは、プロジェクトの data-open（絞り込み）より先に、データが無いときだけ扱う");
  assert.match(vc, /openFile\("choose", pick\.dataset\.open\)/);
  const fb = src.slice(src.indexOf('$("filebar").addEventListener("click"'), src.indexOf('$("banner").addEventListener("click"'));
  assert.match(fb, /openFile\("choose", pick\.dataset\.open\)/);
  const bar = src.slice(src.indexOf('$("filebar").innerHTML'), src.indexOf('$("filebar").innerHTML') + 1200);
  assert.ok(bar.includes("renderFileChips(") && !bar.includes("data-open="), "上部のバーのファイルを選ぶボタンは、札の詳細（views/filechips.js）の中にある");
});

test("app.js: 読み直し（「更新」・バナーの再読込）は、失敗しても sync.reset() する（破棄すると伝えた編集を、あとで当て直さない）", () => {
  const fn = src.slice(src.indexOf("async function reloadFile"), src.indexOf("async function reloadFile") + 800);
  assert.ok(fn.length > 50);
  assert.match(fn, /catch \(e\) \{[^}]*\}\s*sync\.reset\(\);/, "reset は try の外（例外のときも通る）");
  assert.equal((src.match(/store\.reload\(\)/g) ?? []).length, 1, "store.reload を呼ぶのは reloadFile だけ");
  assert.match(src, /\[data-refresh\][\s\S]{0,400}reloadFile\(/);
  assert.match(src, /\[data-reload\][\s\S]{0,200}reloadFile\(/);
});

test("app.js: 共有に無い枠の削除は、確認（S.pendingOrphan）を挟んで apply で保存し、読み直し・他の更新の取り込みでもバナーを出し直す", () => {
  assert.match(src, /data-orphan-clear\]"\)\) \{ S\.pendingOrphan = true/);
  assert.match(src, /data-orphan-ok[\s\S]{0,200}apply\(\(d\) => removeOrphanSessions\(d\)/);
  assert.match(src, /setData: \(d\) => \{ S\.data = d; if \(!sync\.failed\) refreshBanner\(\)/);
  assert.match(src, /else \{ S\.pendingOrphan = false; refreshBanner\(\); \}\s*render\(\);/, "reloadFile の成功でも出し直し、確認の状態は下ろす");
  assert.match(src.slice(src.indexOf("function loaded(")), /S\.pendingOrphan = false;\s*refreshBanner\(\)/, "loaded も確認の状態を下ろす");
  // 失敗の案内（再読込・書き出しのボタンつき）は、削除のボタンで上書きしない。削除の UI は検証の注意（validated）にだけ付く
  assert.match(src, /const orphans = actions\.validated \?/);
  assert.match(src, /const again = \(\) => banner\(S\.banner\.msg, S\.banner\.actions\)/);
  assert.match(src, /data-orphan-clear\]"\)\) \{ S\.pendingOrphan = true; again\(\); \}/, "押しても検証の結果で上書きしない");
  assert.match(src, /if \(!msg && !actions\.validated && S\.data\) \{ refreshBanner\(\); return; \}/, "空の文は、検証の結果の出し直し");
});

test("app.js: 直接保存できないブラウザの書き出しは exportFiles の 2 ファイルを続けて落とし、読み込みは 2 ファイルを dataFromTexts で結合する（1 ファイルを丸ごとデータにしない）", () => {
  const dl = src.slice(src.indexOf("function downloadJson()"), src.indexOf("/** 保存と読み直し"));
  assert.match(dl, /exportFiles\(S\.data\)/);
  assert.match(dl, /a\.download = name/);
  assert.doesNotMatch(dl, /"data\.json"/, "名前は exportFiles が決める");
  assert.match(src, /<input type="file" multiple /);
  assert.match(src, /dataFromTexts\(texts, /);
  assert.doesNotMatch(src, /loaded\(JSON\.parse/);
});

test("app.js: 開いた画面で別のファイルを選べなかったときは、通知で知らせる。読み直せない案内は、画面が古い可能性を伝える", () => {
  assert.match(src, /if \(S\.data\) toast\(S\.openError\)/);
  assert.match(src, /読み直せません: \$\{err\.message\}（画面の内容は、まだファイルと違う可能性があります）/);
});

test("app.js: 読み直しの描き直しを、打ちかけの入力の間は待たせる（isEditing → flush・rendered）。突発タスクの入力は、確定（change）で下書きに残す", () => {
  const editing = src.slice(src.indexOf("function isEditing("), src.indexOf("function isEditing(") + 500);
  assert.match(editing, /document\.activeElement/);
  assert.match(editing, /view\.contains\(/);
  assert.match(editing, /\.value !== [^\n]*\.defaultValue/);
  assert.match(src, /createSync\(\{[\s\S]{0,400}isEditing[,\s}]/, "createSync に isEditing を渡す");
  const render = src.slice(src.indexOf("function render() {"), src.indexOf("function render() {") + 300);
  assert.match(render, /sync\.rendered\(\)/, "ほかの理由の描き直しで、待たせた描き直しを捨てる");
  assert.match(src, /const flushSoon = \(\) => setTimeout\(\(\) => \{ if \(!pressing\) sync\.flush\(\); \}, 0\);/, "setTimeout で、change の処理・フォーカスの移動のあとに flush。押している間はしない");
  assert.match(src, /view\.addEventListener\("focusout", flushSoon\)/, "フォーカスが移り終わってから flush");
  assert.match(src, /view\.addEventListener\("change", flushSoon\)/, "change の処理（setTimeout）のあとで flush");
  assert.ok(src.indexOf('view.addEventListener("change", (e) => { const el = e.target; setTimeout(() => onChange(el), 0); });') < src.indexOf('view.addEventListener("change", flushSoon)'), "onChange の登録が先（同じ change で onChange のあとに flush が走る）");
  // マウスで押したボタンを、描き直しで消さない（押す → change・focusout → 描き直し → 離す、だとクリックが届かない）。離したあと（click の処理のあと）に flush
  assert.match(src, /document\.addEventListener\("pointerdown", [^\n]*pressing = true[^\n]*, true\)/);
  assert.match(src, /document\.addEventListener\("pointerup", release, true\)/);
  assert.match(src, /document\.addEventListener\("pointercancel", release, true\)/);
  assert.match(src, /const release = \(\) => \{ if \(!pressing\) return; pressing = false;[^\n]*flushSoon\(\); \};/);
  assert.match(src, /pointerdown[^\n]*setTimeout\(release, \d+\)/, "離した知らせが来なくても、待たせた描き直しを失わない");
  const onChange = src.slice(src.indexOf("function onChange(el) {"), src.indexOf("function onChange(el) {") + 1500);
  assert.match(onChange, /el\.dataset\.ug !== undefined[^\n]*S\.urgentDraft = \{ \.\.\.S\.urgentDraft/, "突発タスクの欄は change で下書きへ");
  assert.match(src, /if \(d\.ug\) return q\("data-ug", d\.ug\)/, "欄を移ったときの描き直しでも、フォーカスを保つ");
});

test("app.js: スケジュールを開いたとき（resetScroll）は、今の時刻によらず、08:00 が固定の段（stackBottom）のすぐ下に来るまでページを縦にスクロールする", () => {
  const r = src.slice(src.indexOf("function render() {"), src.indexOf("function render() {") + 5000);
  assert.ok(r.includes('if (reset && S.screen === "schedule") scrollToMorning();'), r);
  const fn = src.slice(src.indexOf("function scrollToMorning()"), src.indexOf("function scrollToMorning()") + 700);
  assert.ok(fn.includes("pc(MORNING)") && fn.includes("stackBottom()") && !fn.includes("clock()"), fn);
  assert.match(src, /const MORNING = 8 \* 60;/);
  assert.ok(!src.includes("scrollToNow"));
});

test("theme.css: カレンダーの高さは固定（日・週とも 1 時間 88px・15 分 22px で 2112px）。画面の高さに合わせて縮めない。15 分・30 分未満の枠は、時刻と件名を 1 行に並べる", () => {
  assert.ok(css.includes(".cal{position:relative;--calh:2112px}") && !css.includes(".cal.wk{--calh:"));
  assert.ok(css.includes("#view .cal .blk.short .tm{display:inline;margin-right:4px}"));
});

test("app.js: 作業枠を押して選ぶと（selectSession）、そのタスクの編集欄を開く。選び直すと切り替わり（詳細の開閉は引き継ぐ）、外すと閉じる。「閉じる」は選択も外す", () => {
  assert.ok(!src.includes("data-tedit-open") && !src.includes("teditOpen"), "「タスクを編集」のボタンは持たない");
  const fn = src.slice(src.indexOf("const selectSession = "), src.indexOf("const selectSession = ") + 400);
  assert.ok(fn.includes("Object.assign(S, sessionSelection(S.data, id, S.taskEdit))"), fn); // 規則は views.test.js の sessionSelection
  assert.match(src, /if \(sb && !q\("\[data-rz\]"\)\) \{ const id = sb\.dataset\.dragsess \?\? sb\.dataset\.actbar \?\? sb\.dataset\.ghost; selectSession\(S\.selSess === id \? null : id\);/);
  assert.match(src, /if \(q\("\[data-tedit-close\]"\)\) \{ clearSel\(\); render\(\); return; \}/);
});

test("app.js: 実績のブロック（data-actbar）・枠の影（data-ghost）の押下は、data-dragsess と同じ選択の処理に入る（欄外のクリックで外さない）。ドラッグ・下端のサイズ変更には入れない", () => {
  assert.ok(src.includes('const sb = q("[data-dragsess],[data-actbar],[data-ghost]");'));
  assert.match(src, /!q\("\[data-urgent-open\],\[data-dragsess\],\[data-actbar\],\[data-ghost\],\[data-mtg\],\[data-mact\],\[data-mghost\],/);
  const dragLine = src.split("\n").find((l) => l.includes('e.target.closest("[data-dragtask]")'));
  assert.ok(dragLine && !/actbar|ghost|mact/.test(dragLine), dragLine);
  const rzLine = src.split("\n").find((l) => l.includes('e.target.closest("[data-rz],[data-rzm]")'));
  assert.ok(rzLine && !/actbar|ghost|mact/.test(rzLine), rzLine);
});

test("theme.css: 予定の影（.pghost）は、透明の背景と点線の枠で、ブロックより下（z-index 0）。会議の実績後（.blk.mtg.act）は、会議の縁の色を混ぜた濃い背景と、実線の縁。凡例の見本も同じ。色は変数だけ（ダーク配色でも読める）", () => {
  assert.ok(css.includes(".blk.task.pghost,.blk.mtg.pghost{background:transparent;border:1px dashed var(--accent);color:var(--muted);opacity:.7;z-index:0;cursor:pointer}"));
  assert.ok(css.includes(".blk.mtg.act{background:color-mix(in srgb,var(--meeting-edge) 32%,var(--surface));border:1px solid var(--meeting-edge);border-left:4px solid var(--meeting-edge)}"));
  assert.ok(css.includes(".sw.mtgact{") && css.includes(".sw.pghost{"));
});

test("theme.css・schedule.js: 予定の影の class は、ドラッグの見本（.ghost。pointer-events:none）と別の名前（pghost）。影の規則は pointer-events:none を持たない（押して選べる）。ドラッグの見本の .ghost の規則はそのまま", () => {
  const sc = readFileSync(new URL("../plugins/project-lens/src/ui/views/schedule.js", import.meta.url), "utf8");
  assert.ok(!/class="[^"]*\bghost\b/.test(sc) && !/\bsw ghost\b/.test(sc) && !/\$\{kind\} ghost"/.test(sc), "schedule.js の class に ghost を使わない");
  const rules = css.match(/[^{}]*\bpghost\b[^{}]*\{[^}]*\}/g) ?? [];
  assert.ok(rules.length >= 2, rules.join("\n"));
  for (const r of rules) assert.ok(!/pointer-events\s*:\s*none/.test(r), r);
  assert.ok(!/(^|[}\s,])\.blk[^{]*\.ghost\b|\.sw\.ghost\b/.test(css), "影・凡例の規則に .ghost を使わない");
  assert.ok(css.includes(".ghost{position:absolute;left:2px;right:2px;border:2px dashed var(--accent);background:var(--accent-soft);border-radius:5px;font-size:12px;padding:2px 6px;color:var(--accent);pointer-events:none;z-index:5}"), "ドラッグの見本の規則はそのまま");
});

test("app.js: 会議の実績のブロック（data-mact）・会議の影（data-mghost）の押下は、data-mtg と同じ会議の選択（selMtg）に入る", () => {
  assert.ok(src.includes('const mb = q("[data-mtg],[data-mact],[data-mghost]");'));
  assert.match(src, /if \(mb && !q\("\[data-rzm\]"\)\) \{ const id = mb\.dataset\.mtg \?\? mb\.dataset\.mact \?\? mb\.dataset\.mghost; S\.selMtg = S\.selMtg === id \? null : id;/);
});

test("theme.css: スケジュールの凡例の色の見本は 18×14px（線・点線・塗りは .sw の規則のまま）。文字は 12px。現在時刻の線は高さ 0 のまま、行の中央に置く（#view の中だけ）", () => {
  assert.ok(css.includes("#view .toolbar .slegend{margin:0 0 0 10px;gap:2px 12px;font-size:12px}"));
  assert.ok(css.includes("#view .toolbar .slegend .sw{width:18px;height:14px;margin-right:5px}"));
  assert.ok(css.includes("#view .toolbar .slegend .sw.now{height:0}"));
  assert.ok(!css.includes("#view .toolbar .slegend .sw{width:14px"), "小さい見本の規則を残さない");
});

test("theme.css: カレンダーの上の入力欄（#mtgslot）は、中身があるとき、ヘッダーと操作の行の下に固定する（#view の中だけ）", () => {
  assert.ok(css.includes("#view #mtgslot:not(:empty){position:sticky;top:calc(var(--hh,0px) + var(--stop-h,0px));"));
});

test("app.js: 実績の保存（data-actsave）は、入力欄（data-ac）を押した時に読み、recordActual を 1 回の apply で保存し（枠と状態を一緒に）、件名と時刻と、状態を変えたことを通知で言う。プロジェクト画面にも now を渡す", () => {
  const i = src.indexOf('q("[data-actsave]")');
  assert.ok(i > 0, "data-actsave のハンドラ");
  const a = src.slice(i, src.indexOf('q("[data-actclear]")'));
  assert.ok(a.includes('view.querySelector(`[data-ac="${k}"]`)') && a.includes("recordActual(d, taskId, slot, now)") && a.includes("apply("), a);
  assert.equal(a.match(/apply\(/g).length, 2, "apply は、予定の枠（recordSlotActual）と「＋ 実績を追加」（recordActual）の経路で 1 回ずつ");
  assert.ok(a.includes("taskTitle(taskId)") && a.includes("の実績を入れました") && a.includes("状態を In Progress にしました") && a.includes("待ち先の記録は外しました"), a);
  assert.ok(a.includes("clearSel()"), "保存したら、選択と入力欄を閉じる");
  for (const old of ["data-session-actual", "data-confirm", "confirmTodaySession", "confirmSession", "confirmMeeting"]) assert.ok(!src.includes(old), old);
  assert.match(src, /renderProjects\(S\.data, today, \{[^}]*now: clock\(\)/);
  assert.ok(!src.includes("data-rec-start") && !src.includes("data-rec-end") && !src.includes("startActual") && !src.includes("stopActual"), "「開始」「終了」は持たない");
});

test("theme.css: 作業枠・会議のブロックは、短い枠でも 14px の高さで描く（#view の中だけ）", () => {
  assert.ok(css.includes("#view .cal .blk{min-height:14px}"));
});

// ---- 24 時間の軸と、カレンダーの上の入力欄の固定（レビューの指摘） ----
test("sticky.js・theme.css: スケジュールは、ヘッダー・操作の行（.stop）・入力欄（#mtgslot）・週表示の日付の見出し（と左端のセル）を積んで固定する。高さは --stop-h・--slot-h・--dh-h に測る。規則は #view の中だけ", () => {
  assert.match(stk, /root\.setProperty\("--stop-h", `\$\{view\.querySelector\("\.stop"\)\?\.offsetHeight \?\? 0\}px`\)/);
  assert.match(stk, /root\.setProperty\("--slot-h", `\$\{view\.querySelector\("#mtgslot"\)\?\.offsetHeight \?\? 0\}px`\)/);
  assert.match(stk, /root\.setProperty\("--dh-h", `\$\{view\.querySelector\("\.cal\.wk \.week \.dh"\)\?\.offsetHeight \?\? 0\}px`\)/);
  assert.ok(css.includes("#view .stop{position:sticky;top:var(--hh,0px);z-index:9;"));
  assert.ok(css.includes("#view #mtgslot:not(:empty){position:sticky;top:calc(var(--hh,0px) + var(--stop-h,0px));z-index:9;max-height:max(120px,calc(55vh - var(--hh,0px) - var(--stop-h,0px) - var(--dh-h,0px) - var(--due-h,0px)));overflow-y:auto;"), "入力欄は、積んだ高さが画面の 55% を超えないよう、欄の中でスクロールする（下端の帯があっても、カレンダーに約 40% 残す）");
  assert.ok(css.includes("#view .cal.wk .week .dh{top:calc(var(--hh,0px) + var(--stop-h,0px) + var(--slot-h,0px))}"));
  assert.ok(css.includes("#view .cal.wk .week:first-child>div:first-child{position:sticky;top:calc(var(--hh,0px) + var(--stop-h,0px) + var(--slot-h,0px));"));
  assert.ok(css.includes("@media (max-width:640px){#view .cal.wk{overflow-x:auto}}"));
  assert.ok(!/\n\.cal\.wk \.week:first-child/.test(css) && !css.includes("@media (max-width:640px){.cal.wk{"), "#view の外の規則として残さない");
});

test("app.js: 枠を選んで固定の段（編集欄など）が高くなり、選んだ枠が段の下に隠れたら、その下へページを動かす（stackBottom は --hh・--stop-h・--slot-h・--dh-h の和）", () => {
  const r = src.slice(src.indexOf("function render() {"), src.indexOf("function render() {") + 5000);
  assert.ok(r.includes('const selKey = S.screen === "schedule" ? selectionKey(S.selSess, S.taskEdit) : null;'), r);
  assert.ok(r.includes('if (revealSelection(lastSelKey, selKey)) { const b = view.querySelector(".blk.sel")?.getBoundingClientRect(), top = stackBottom(); if (b && b.top < top) window.scrollBy(0, b.top - top - 8); }'), "選択・編集欄が変わった描き直しだけ");
  assert.ok(r.includes("lastSelKey = selKey;"));
  const fn = src.slice(src.indexOf("function stackBottom()"), src.indexOf("function stackBottom()") + 400);
  for (const k of ["--hh", "--stop-h", "--slot-h", "--dh-h", "--due-h"]) assert.ok(fn.includes(`"${k}"`), k);
});

test("sticky.js・theme.css・app.js: 週表示の期限の行は、日付の見出しの下（--dh-h）に固定し、高さを --due-h に測る。開いたセルは高さの上限で、中でスクロールする。開閉（data-sdue）は showDue を反転して保存する", () => {
  assert.match(stk, /root\.setProperty\("--due-h", `\$\{view\.querySelector\("\.cal\.wk \.week \.duehd"\)\?\.offsetHeight \?\? 0\}px`\)/);
  assert.ok(css.includes("#view .cal.wk .week>.duehd,#view .cal.wk .week>.duecell,#view .cal.wk .week>.dueoff{position:sticky;top:calc(var(--hh,0px) + var(--stop-h,0px) + var(--slot-h,0px) + var(--dh-h,0px));z-index:7;"));
  assert.match(css, /#view \.cal\.wk \.week>\.duecell\{max-height:96px;overflow-y:auto/);
  assert.ok(src.includes('if (q("[data-sdue]")) { togglePref("showDue"); return; }'));
  assert.ok(src.includes("showDue: S.prefs.showDue"), "scheduleOpts に渡す");
});

test("app.js: スケジュールの描き直しでは、カレンダー（#calslot）の画面上の位置を保つ（入力欄が開いて上に高さが足されても、押した枠が動かない）", () => {
  const r = src.slice(src.indexOf("function render() {"), src.indexOf("function render() {") + 5000);
  assert.match(r, /const calTop = S\.screen === "schedule" \? view\.querySelector\("#calslot"\)\?\.getBoundingClientRect\(\)\.top : null;/);
  assert.match(r, /if \(calTop != null && !reset && S\.screen === "schedule"\)/);
});

test("app.js: 右の列の開け閉めで今日の位置へ戻すのは、ガントのときだけ（スケジュールでは scrollToMorning で跳ばない）", () => {
  const fn = src.slice(src.indexOf("function togglePref(key)"), src.indexOf("function togglePref(key)") + 400);
  assert.match(fn, /if \(key === "showPrio" && S\.screen === "gantt"\) S\.resetScroll = true;/);
});

test("app.js: Delete・Backspace は、編集欄・入力欄（[data-tedit]・.mtgform・.actform）の中のボタンにフォーカスがあるときは枠を消さない", () => {
  assert.ok(src.includes('const typing = e.target.matches?.("input,select,textarea") || !!e.target.closest?.("[data-tedit], .mtgform, .actform");'));
});

test("app.js: 実績の入力欄（.actform）・実績の追加（data-actadd）・会議の実績の保存（data-mtgact）のクリックでは、選択を外さない。actAdd も選択と一緒に外す", () => {
  const g = src.slice(src.indexOf("// 欄外のクリックで"), src.indexOf("// 欄外のクリックで") + 400);
  for (const s of [".actform", "[data-actadd]", "[data-actsave]", "[data-mtgact]", "S.actAdd"]) assert.ok(g.includes(s), s);
  assert.match(src, /const clearSel = \(\) => \{[^}]*S\.actAdd = null;/);
  assert.match(src, /S\.actAdd = \{ date \}/);
  assert.ok(src.includes("actAdd: S.actAdd"), "scheduleOpts に渡す");
  assert.ok(src.includes("data-actadd") && src.includes("＋ 実績を追加"));
  assert.ok(src.includes('if (q("[data-actcancel]")) { S.actAdd = null; S.actDraft = null; render(); return; }'));
});

test("app.js: 会議の実績の保存（data-mtgact）は、入力欄（data-ma）を押した時に読み、setMeetingActual で保存する", () => {
  const i = src.indexOf('q("[data-mtgact]")');
  assert.ok(i > 0);
  const a = src.slice(i, i + 500);
  assert.ok(a.includes('view.querySelector(`[data-ma="${k}"]`)') && a.includes("setMeetingActual(d, id, span, now)") && a.includes('upd = S.data.events.find((m) => m.id === id)?.confirmed === true') && a.includes('upd ? "会議の実績を更新しました" : "会議の実績を入れました"'), a);
});

test("app.js: 読み直しなどで選択中の枠が無くなったら、選択と編集欄を外す", () => {
  assert.ok(src.includes("if (S.selSess && !allSessions(S.data).some((s) => s.id === S.selSess)) { S.selSess = null; S.taskEdit = null; }"));
});

test("app.js: 書式（filebar の行の renderBar、keydown の閉じ）", () => {
  assert.ok(!src.includes('` : "";  renderBar();') && !src.includes("return; }});"));
});

test("app.js: 一括の「実績にする」（data-confirmall）は持たない。setStatus は実行中の枠を扱わない", () => {
  const fn = src.slice(src.indexOf("function setStatus("), src.indexOf("function setStatus(") + 1500);
  assert.ok(!fn.includes("stopRunningIfClosed") && !fn.includes("実行中"), fn);
  assert.ok(!src.includes("data-confirmall"));
});

test("theme.css: スケジュールの重要の枠は、件名の赤い太字だけ（左の赤い線は付けない）", () => {
  assert.ok(css.includes("#view .blk.imp .ttl{color:var(--bad);font-weight:700}"));
  assert.ok(!/\.blk\.imp\{[^}]*box-shadow/.test(css), "左の線（box-shadow）は持たない");
});

test("theme.css: いまのブロックは「いま」の文字だけ（赤い外枠を持たない）。現在時刻の線は 1 つの見た目（.nowline.off などの違いを持たない）で、クリックを通す", () => {
  assert.ok(!/\.blk\.now\{[^}]*box-shadow/.test(css), "外枠（box-shadow）を持たない");
  assert.ok(css.includes(".blk .nw{color:var(--bad);font-weight:700"));
  assert.ok(!/\.nowline\.[\w-]+/.test(css), "線の見た目の違い（.nowline.off など）を持たない");
  assert.ok(/\.nowline\{[^}]*border-top:2px solid var\(--bad\)[^}]*pointer-events:none/.test(css), "2px の --bad。pointer-events:none");
});

test("theme.css: プロジェクトの稼働の札（.mono.hrs）の塗りは、週表示の時刻の列（.week .hrs）に効かない。使わなくなった今日のタスクのボタンの箱（.rank .bb）の規則は持たない", () => {
  assert.ok(css.includes(".mono.hrs{background:var(--accent-soft);"));
  assert.ok(!/(^|\n)\.hrs\{/.test(css), "素の .hrs に塗りを付けない");
  assert.ok(!css.includes(".rank .bb") && !css.includes(".rank.tl .bb"));
});

test("app.js: スケジュールから届く通知（実績の保存・状態の変更・待ち先・タスクの削除・定例の次回）は、タスクの ID でなく件名で言う", () => {
  for (const bad of ["${r.taskId} の ${s.start}", "${id} の状態を ${status}", "${id} を Waiting にしました", "${id} を削除しました", "次回 ${sp.id}"]) assert.ok(!src.includes(bad), bad);
  assert.ok(src.includes("taskTitle("), "件名を引く");
});

test("theme.css: スケジュールも、ガント・リストと同じく、ページの先頭で、固定の段（操作の行 .stop・入力欄・日付の見出し・右の列）が固定したときと同じ位置にある（ヘッダーとの間を詰め、カードの上の余白は .stop の中に持たせる）", () => {
  for (const rule of [
    ".wrap:has(.ptool),.wrap:has(.stop){gap:0}",
    "#view section.panel:has(> .gtop),#view section.panel:has(> .pstick),#view section.panel:has(> .stop){padding-top:0}",
    "#view section.panel > .stop{padding-top:16px}",
  ]) assert.ok(css.includes(rule), rule);
});

test("app.js: render は、画面を描けない例外（不正な日付など）で固まらず、理由とバナーを出す", () => {
  const body = src.slice(src.indexOf("function render()"), src.indexOf("function focusSelector"));
  assert.match(body, /try \{\s*view\.innerHTML = renderBody\(\);\s*\} catch \(e\) \{[\s\S]*?画面を描けません[\s\S]*?refreshBanner\(\)/);
});

test("app.js: 実績の入力欄（data-ac・data-ma）は、change で S.actDraft（key 付き）へ写し、保存の成功・キャンセル・選択の変更（clearSel）で消す。保存の失敗では消さない", () => {
  const onChange = src.slice(src.indexOf("function onChange(el) {"), src.indexOf("function onChange(el) {") + 2500);
  assert.match(onChange, /el\.dataset\.ac !== undefined \|\| el\.dataset\.ma !== undefined[\s\S]*S\.actDraft = \{ key:/, "change で下書きへ");
  assert.ok(src.includes("actDraft: S.actDraft"), "描画へ渡す");
  assert.match(src, /const clearSel = \(\) => \{[^\n]*S\.actDraft = null/, "選択を外すと消す");
  const i = src.indexOf('q("[data-actsave]")');
  const a = src.slice(i, src.indexOf('q("[data-actcancel]")'));
  assert.ok(a.includes("clearSel(); render();"), "枠・追加の保存の成功は clearSel で消す");
  assert.ok(!a.slice(0, a.indexOf("if (apply(")).includes("S.actDraft = null"), "失敗の経路では消さない");
  assert.ok(src.includes('if (apply((d) => setMeetingActual(d, id, span, now), upd ? "会議の実績を更新しました" : "会議の実績を入れました")) S.actDraft = null;'), "会議は成功したときだけ消す");
});

test("app.js: 実績の下書きは、入力欄を囲む実績の欄（.actform。枠と会議で共通）から、会議（data-mtgact）か枠（data-actsave）かを読む。会議の実績の欄は会議の編集欄（.mtgform）の外にある", () => {
  const onChange = src.slice(src.indexOf("function onChange(el) {"), src.indexOf("function onChange(el) {") + 2500);
  assert.ok(onChange.includes('const form = el.closest(".actform"), g = '), onChange.slice(0, 1500));
  assert.ok(!onChange.includes('closest(".actform, .mtgform")'), "会議の実績の入力欄は .mtgform の中に無い");
  assert.ok(onChange.includes('form?.querySelector("[data-mtgact]")?.dataset.mtgact') && onChange.includes('form?.querySelector("[data-actsave]")?.dataset.actsave'));
});

test("app.js: 予定の枠の実績の保存（data-actsave に枠の ID）は、日付・開始・終了を下書きへ先に写し、空・不正なら通知して下書きを残し、recordSlotActual を apply に通す。初回と更新で通知を分ける", () => {
  const i = src.indexOf('q("[data-actsave]")');
  const a = src.slice(i, src.indexOf('q("[data-actcancel]")'));
  const slotPath = a.slice(0, a.indexOf("recordActual(d, taskId"));
  assert.match(slotPath, /S\.actDraft = \{ key: sid, task: "", \.\.\.slot \};[\s\S]*isDate\(slot\.date\)[^\n]*toast\("日付・時刻を入力してください"\); return; \}/, slotPath);
  assert.ok(slotPath.indexOf("S.actDraft = { key: sid") < slotPath.indexOf("isDate(slot.date)"), "検査の前に下書きへ写す");
  assert.match(slotPath, /apply\(\(d\) => \{ r = recordSlotActual\(d, sid, slot, now\); return r\.data; \}, null, \{ quiet: true \}\)/);
  assert.ok(!slotPath.slice(0, slotPath.indexOf("if (apply(")).includes("S.actDraft = null"), "失敗の経路では下書きを消さない");
  assert.ok(slotPath.includes("clearSel(); render();"), "成功で選択と下書きを外す");
  assert.ok(slotPath.includes("の実績を ${slot.start}–${slot.end} に更新しました") && slotPath.includes("の ${slot.start}–${slot.end} の実績を入れました"), slotPath);
  assert.ok(slotPath.includes("taskTitle(r.taskId)"));
});

test("app.js: 実績を消す（data-actclear）は clearActual を apply に通し、成功で下書きを消し、件名で通知する。欄外のクリックでも選択を外さない", () => {
  const i = src.indexOf('q("[data-actclear]")');
  assert.ok(i > 0, "data-actclear のハンドラ");
  const a = src.slice(i, i + 600);
  assert.match(a, /apply\(\(d\) => \{ const r = clearActual\(d, s\.id\); if \(r\.error\) throw new Error\(r\.error\); return r\.data; \}, null, \{ quiet: true \}\)/, a);
  assert.ok(a.includes("S.actDraft = null") && a.includes("の実績を消しました") && a.includes("taskTitle(s.taskId)"), a);
  const g = src.slice(src.indexOf("// 欄外のクリックで"), src.indexOf("// 欄外のクリックで") + 400);
  assert.ok(g.includes("[data-actclear]"), g);
});

test("ToDo タブ: index.html のタブ（スケジュールと稼働の間）、renderBody の renderTodo（週・入力欄の行・下書き）、build の MODULES（schedule.js の後）", () => {
  const html = readFileSync(new URL("../plugins/project-lens/src/ui/index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="tab-schedule"') < html.indexOf('id="tab-todo"') && html.indexOf('id="tab-todo"') < html.indexOf('id="tab-workload"'));
  assert.ok(src.includes("S.screen = b.id.slice(4)"), "tab-todo のクリックで S.screen が todo になる");
  const body = src.slice(src.indexOf("function renderBody()"), src.indexOf("function placeTaskPop"));
  assert.ok(body.includes('S.screen === "todo") return renderTodo(S.data, today, { week: S.todoWeek, now: clock(), open: S.tdOpen, col: S.tdCol, draft: S.tdDraft, plan: S.tdPlan, chase: S.tdChase, urgentDraft: S.urgentDraft });'), body);
  const build = readFileSync(new URL("../plugins/project-lens/tools/build.js", import.meta.url), "utf8");
  assert.ok(build.indexOf('"src/ui/views/schedule.js"') < build.indexOf('"src/ui/views/todo.js"'));
});

test("ToDo タブ: 古い ToDo の状態・ハンドラ・関数は無い", () => {
  for (const s of ["todoDay", "tdAct", "tdAskDel", "renderTodayTodos", "setTodoDay", "submitTodoInput", "deleteTodoNow", "data-tdnew", "data-tdday", "data-tdassign", "data-tdcarry", "data-tddel", "data-tdactsave", "dataset.tdone", "dataset.tdtitle", "dataset.tdcktoggle", "dataset.ta ", "addTodo(", "assignToDay(", "carryTodo(", "deleteTodo(", "ToDo）"]) assert.ok(!src.includes(s), s);
  assert.ok(src.includes('for (const k of ["tdnote", "tf", "tdckadd", "tp", "ch"])'), "入力中の欄（読み直しで描き直さない・フォーカスを保つ）");
});

test("ToDo タブ: 入力欄の項目の追加（data-tdckadd の Enter。isComposing を除く）・削除（data-tdckdel）は、先に S.tdDraft へ写してから apply ですぐ保存する", () => {
  const i = src.indexOf('e.target.closest("[data-tdckadd]")'), a = src.slice(i, i + 600);
  assert.ok(i > 0, "追加のハンドラ");
  assert.ok(a.includes('e.key !== "Enter" || e.isComposing') && a.includes("e.preventDefault()"), "Enter だけ。変換確定は除く");
  assert.ok(a.includes("if (!text) return;"), "空は追加しない");
  assert.ok(a.indexOf("S.tdDraft = tdFormDraft(") > 0 && a.indexOf("S.tdDraft = tdFormDraft(") < a.indexOf("addChecklistItem(d, id, text)"), "下書きが先");
  assert.match(a, /apply\(\(d\) => addChecklistItem\(d, id, text\)\)/);
  assert.ok(a.includes('S.focusSel = `[data-tdckadd="${id}"]`'), "追加の欄へフォーカスを戻す");
  const j = src.indexOf('q("[data-tdckdel]")'), b = src.slice(j, j + 500);
  assert.ok(j > 0, "削除のハンドラ");
  assert.ok(b.indexOf("S.tdDraft = tdFormDraft(") > 0 && b.indexOf("S.tdDraft = tdFormDraft(") < b.indexOf("removeChecklistItem(d, tid, iid)"), "下書きが先");
  assert.match(b, /apply\(\(d\) => removeChecklistItem\(d, tid, iid\)\)/);
});

test("ToDo タブ: 状態（S.todoWeek・S.tdOpen・S.tdDraft）。描き直しで、無いタスクの入力欄を閉じる。画面の移動・週の移動・clearSel で閉じる", () => {
  assert.match(src, /todoWeek: mondayOf\(clock\(\)\.date\), tdOpen: null, tdCol: null, tdDraft: null/);
  assert.ok(src.includes('if (S.tdOpen && (!S.data?.tasks.some((t) => t.id === S.tdOpen) || !["today", "week"].includes(S.tdCol))) { S.tdOpen = null; S.tdCol = null; S.tdDraft = null; }'), "無いタスク・列の値が無い／不正なら閉じる");
  assert.match(src, /const clearSel = \(\) => \{[^\n]*S\.tdOpen = null; S\.tdCol = null; S\.tdDraft = null;/);
  assert.match(src, /function moveTodoWeek\(week\) \{[^}]*S\.tdOpen = null; S\.tdCol = null; S\.tdDraft = null;/);
});

test("ToDo タブ: 完了（data-tdopen）は開閉。残りをすべてチェック（data-tdckall）は描き直さずに欄を変える。キャンセル（data-tdcancel）は閉じる", () => {
  assert.match(src, /const tdo = q\("\[data-tdopen\]"\);\s*if \(tdo\) \{ const id = tdo\.dataset\.tdopen, col = tdo\.dataset\.tdcol, same = S\.tdOpen === id && S\.tdCol === col; S\.tdOpen = same \? null : id; S\.tdCol = same \? null : col; S\.tdDraft = null;/); // 押した列（S.tdCol）の行にだけ開く。同じ列の同じ行で閉じる
  const i = src.indexOf('q("[data-tdckall]")'), a = src.slice(i, i + 600);
  assert.ok(i > 0 && a.includes("[data-tfck]") && a.includes(".checked = true") && !a.includes("render()"), a);
  assert.ok(a.indexOf(".checked = true") < a.indexOf("if (key && key === S.tdOpen) S.tdDraft = tdFormDraft(form, key);"), "change が起きないので、チェックを付けたあとで下書きへ写す（読み直しの描き直しで戻らない）");
  assert.match(src, /q\("\[data-tdcancel\]"\)\) \{ S\.tdOpen = null; S\.tdCol = null; S\.tdDraft = null; render\(\); return; \}/);
});

test("ToDo タブ: 保存（data-tdsave）は、欄の値を先に S.tdDraft へ写してから completeTask を apply に通す。成功で閉じて、状態・解除・次回を通知する", () => {
  const i = src.indexOf('const tds = q("[data-tdsave]")'), a = src.slice(i, i + 1600);
  assert.ok(i > 0, "ハンドラ");
  assert.ok(a.indexOf("S.tdDraft = tdFormDraft(") >= 0 && a.indexOf("S.tdDraft = tdFormDraft(") < a.indexOf("completeTask(d, id"), "下書きが先");
  assert.match(src, /function tdFormDraft\(form, key\) \{[^]*?return \{ key, date: f\("date"\), start: f\("start"\), end: f\("end"\), status: f\("status"\), checks \};/);
  assert.match(a, /apply\(\(d\) => \{ r = completeTask\(d, id, completeInput\(draft\), now\); return r\.data; \}, null, \{ quiet: true \}\)/); // 入力の変換は views.test.js の completeInput
  assert.match(a, /S\.tdOpen = null; S\.tdCol = null; S\.tdDraft = null; render\(\);/);
  for (const s of ["にしました", "未来の予定の枠 ${r.released} 件を解除しました", "次回（期限"]) assert.ok(a.includes(s), s);
  assert.ok(src.includes("if (el.dataset.tdnote !== undefined) {") && src.includes("setReview(d, wk, text)"), "気づきは change で setReview");
});

test("週の見返しの気づき（data-tdnote）: 稼働タブでも保存する。change の処理は画面で限らない。フォーカス・打ちかけの保護も画面によらない", () => {
  const fn = src.slice(src.indexOf("function onChange("), src.indexOf("if (el.dataset.tdnote !== undefined) {"));
  assert.ok(fn.length > 0 && !fn.includes("S.screen"), "気づきの処理の前に、画面の条件で return しない");
  assert.ok(src.includes('if (el.dataset.tdnote !== undefined) { const wk = el.dataset.tdnote, text = el.value.trim(); apply((d) => setReview(d, wk, text), "気づきを保存しました"); return; }'));
  assert.ok(src.includes('view.addEventListener("change", (e) => { const el = e.target; setTimeout(() => onChange(el), 0); });'), "change はどの画面でも onChange へ");
  const fs = src.slice(src.indexOf("function focusSelector("), src.indexOf("/** カレンダー部分だけを描き直す"));
  assert.ok(fs.includes('"tdnote"') && !fs.includes("S.screen"), "focusSelector は画面によらず tdnote を扱う");
  const ed = src.slice(src.indexOf("function isEditing("), src.indexOf("function isEditing(") + 400);
  assert.ok(ed.includes('el.tagName === "TEXTAREA"') && !ed.includes("S.screen"), "打ちかけの textarea は画面によらず守る");
  assert.ok(src.includes('if (S.screen === "workload") return renderWorkload(S.data, today, { period: S.wperiod, date: S.wdate, now: clock() });'), "稼働は表示中の日（S.wdate）を渡す");
});

test("枠の削除: actual を持つ予定の枠は S.askDelSess に入れて描き直し、すぐ消さない。data-delsessok で removeSession、data-delsessno で外す。ほかの枠は 1 回で削除", () => {
  const i = src.indexOf("function deleteSelected()");
  const f = src.slice(i, src.indexOf("/** 表示の好み", i));
  assert.match(f, /s\.kind === "planned" && s\.actual\) \{ S\.askDelSess = s\.id; render\(\); return; \}[^\n]*\n  removeSelectedSession\(s\);/);
  assert.match(f, /function removeSelectedSession\(s\) \{[^]*?S\.askDelSess = null;[^]*?apply\(\(d\) => removeSession\(d, s\.id\)/);
  assert.match(f, /枠（実績つき）/);
  const ok = src.slice(src.indexOf("const dsok"), src.indexOf("const dsok") + 420);
  assert.match(ok, /S\.askDelSess === s\.id\) removeSelectedSession\(s\)/);
  assert.match(ok, /q\("\[data-delsessno\]"\)\) \{ S\.askDelSess = null; render\(\)/);
  assert.match(src, /askDelSess: S\.askDelSess/);
  assert.match(src, /const clearSel = \(\) => \{[^\n]*S\.askDelSess = null;/);
  assert.match(src, /\[data-delsel\],\[data-delsessok\],\[data-delsessno\]/, "確認のボタンは、欄外のクリックにならない");
  assert.match(src, /S\.askDelSess && \(S\.screen !== "schedule" \|\| S\.askDelSess !== S\.selSess\)\) S\.askDelSess = null/);
  assert.ok(!/S\.askDelSess[^;]*tasks\.some/.test(src), "S.data.tasks で検証しない");
});

test("app.js: 実績の保存（枠モード）と実績を消すは、成功のあと確認待ち（S.askDelSess）を外す", () => {
  const i = src.indexOf('q("[data-actsave]")');
  const save = src.slice(i, src.indexOf('q("[data-actclear]")'));
  assert.ok(save.includes("clearSel(); render();"), "保存の成功時は clearSel()");
  assert.ok(/const clearSel = [^\n]*S\.askDelSess = null/.test(src), "clearSel が askDelSess を外す");
  const j = src.indexOf('q("[data-actclear]")');
  const clr = src.slice(j, j + 600);
  assert.ok(clr.includes("S.askDelSess = null"), clr);
});

test("app.js: 会議の実績を消す（data-mtgactclear）は clearMeetingActual を apply に通し、成功で下書きを消す。欄外のクリックでも選択を外さない", () => {
  const i = src.indexOf('q("[data-mtgactclear]")');
  assert.ok(i > 0, "data-mtgactclear のハンドラ");
  const a = src.slice(i, i + 400);
  assert.ok(a.includes("apply((d) => clearMeetingActual(d, ") && a.includes("会議の実績を消しました") && a.includes("S.actDraft = null"), a);
  assert.ok(src.slice(src.indexOf("// 欄外のクリックで"), src.indexOf("// 欄外のクリックで") + 400).includes("[data-mtgactclear]"));
});

test("app.js: 突発タスクは ToDo タブで画面を移さずに登録できる", () => {
  const i = src.indexOf("function openUrgent()");
  assert.ok(i > 0);
  const h = src.slice(i, src.indexOf('$("filebar").addEventListener("click"'));
  assert.ok(/S\.screen !== "todo"/.test(h) || /S\.screen === "todo"/.test(h), "ToDo タブの分岐");
  assert.match(h, /if \(S\.screen !== "todo"\) \{[^}]*S\.screen = "schedule"/, "移すのは ToDo タブ以外だけ");
  const j = src.indexOf("function submitUrgent");
  const s = src.slice(j, src.indexOf("\n}\n", j));
  assert.match(s, /S\.screen !== "todo"/, "保存の成功は ToDo タブで S.sdate を変えない");
  assert.ok(!/S\.screen = /.test(s), "保存は画面を移さない");
  assert.match(src, /e\.key === "Escape" && \(S\.screen === "schedule" \|\| S\.screen === "todo"\)/);
  const calls = [...src.matchAll(/renderTodo\([^\n]*/g)].map((m) => m[0]);
  assert.ok(calls.length && calls.every((c) => c.includes("urgentDraft: S.urgentDraft")), calls.join("\n"));
});

test("ToDo タブ: 今日へ（data-tdplan）は S.tdPlan を開き（planDefault の初期値）、S.tdOpen を外す。完了（data-tdopen）は S.tdPlan を外す", () => {
  assert.match(src, /tdDraft: null, tdPlan: null/);
  const i = src.indexOf('const tdp = q("[data-tdplan]")'), h = src.slice(i, src.indexOf("return; }", i));
  assert.ok(i > 0, "ハンドラ");
  assert.match(h, /if \(S\.tdPlan\?\.key === id\) \{ S\.tdPlan = null; S\.focusSel = null; render\(\); \} else openPlan\(id\);/, "同じ行をもう一度押すと閉じる");
  const j = src.indexOf("function openPlan(id)"), a = src.slice(j, src.indexOf("\n}", j));
  assert.ok(j > 0, "開く処理（ボタンとドロップで共通）");
  assert.ok(a.includes("planDefault(clock())") && a.includes("key: id"), a);
  assert.ok(a.includes("S.tdOpen = null; S.tdCol = null; S.tdDraft = null;"), "完了の入力欄を閉じる");
  assert.ok(a.includes(`S.focusSel = '[data-tp="start"]';`) && a.includes("render();"), a);
  assert.match(src, /const tdo = q\("\[data-tdopen\]"\);\s*if \(tdo\) \{[^\n]*S\.tdDraft = null; S\.tdPlan = null;/);
  assert.match(src, /q\("\[data-tdplancancel\]"\)\) \{ S\.tdPlan = null; render\(\); return; \}/);
});

test("ToDo タブ: 候補の行（data-tdrag）のドラッグ。dragstart で kind \"today\"、dragover は左の列（data-tddrop）の上だけ preventDefault と強調、drop で openPlan、dragend で強調を外す", () => {
  const body = (ev) => { const i = src.indexOf(`view.addEventListener("${ev}"`); return src.slice(i, src.indexOf("\n});", i) + 4); };
  const ds = body("dragstart");
  assert.match(ds, /const tr = e\.target\.closest\("\[data-tdrag\]"\);[^\n]*\s*if \(tr\) \{ drag = \{ kind: "today", id: tr\.dataset\.tdrag \}; e\.dataTransfer\.setData\("text\/plain", drag\.id\); e\.dataTransfer\.effectAllowed = "copy"; return; \}/);
  assert.ok(ds.indexOf("[data-tdrag]") < ds.indexOf("[data-ckmv]"), "既存の判定より先に抜ける");
  const ov = body("dragover"), ot = ov.slice(ov.indexOf('if (drag?.kind === "today")'), ov.indexOf("return;", ov.indexOf('if (drag?.kind === "today")')));
  assert.ok(ov.indexOf('drag?.kind === "today"') >= 0 && ov.indexOf('drag?.kind === "today"') < ov.indexOf('drag?.kind === "ckorder"'), "先に抜ける（.dz・ghost・showTip に進まない）");
  assert.match(ot, /const z = e\.target\.closest\("\[data-tddrop\]"\);/);
  assert.match(ot, /if \(z\) \{ e\.preventDefault\(\); e\.dataTransfer\.dropEffect = "copy"; \}/);
  assert.match(ot, /classList\.toggle\("drop", !!z\)/);
  const dr = body("drop"), dt = dr.slice(dr.indexOf('if (drag?.kind === "today")'), dr.indexOf("return;", dr.indexOf('if (drag?.kind === "today")')));
  assert.ok(dr.indexOf('drag?.kind === "today"') >= 0 && dr.indexOf('drag?.kind === "today"') < dr.indexOf('drag?.kind === "ckorder"'), "先に抜ける");
  assert.ok(dt.includes("clearTdDrop();") && dt.includes("drag = null;") && /if \(e\.target\.closest\("\[data-tddrop\]"\)\) openPlan\(id\);/.test(dt), dt);
  assert.ok(body("dragend").includes("clearTdDrop();"));
  assert.match(src, /const clearTdDrop = \(\) => view\.querySelector\("\[data-tddrop\]\.drop"\)\?\.classList\.remove\("drop"\);/);
  assert.equal(src.split(" openPlan(id);").length, 3, "openPlan を使うのは、ボタンとドロップの 2 か所");
});

test("ToDo タブ: 既存のドラッグ（data-dragtask・data-dragsess・data-dragmtg・data-mvh・data-ckmv）の判定は data-tdrag に当たらない", () => {
  const i = src.indexOf('view.addEventListener("dragstart"'), ds = src.slice(i, src.indexOf("\n});", i));
  const sels = [...ds.matchAll(/closest\("([^"]+)"\)/g)].map((m) => m[1]).filter((s) => s !== "[data-tdrag]");
  assert.ok(sels.length >= 5 && sels.every((s) => !s.includes("tdrag")), sels.join(" "));
});

test("ToDo タブ: 今日に入れる（data-tdplansave）は、先に S.tdPlan へ写してから addSession を apply する。成功のときだけ S.tdPlan を外して通知する", () => {
  const i = src.indexOf('const tps = q("[data-tdplansave]")'), a = src.slice(i, src.indexOf('q("[data-tdplancancel]")', i));
  assert.ok(i > 0, "ハンドラ");
  const w = a.indexOf("S.tdPlan = tdPlanDraft("), ap = a.indexOf("addSession(d, id, { date: today, start, end })");
  assert.ok(w > 0 && ap > w, "写すのが先");
  assert.match(a, /end = toHHMM\(toMin\(start\) \+ minutes\)/);
  assert.match(a, /if \(apply\(\(d\) => \{ r = addSession\(d, id, \{ date: today, start, end \}\); if \(r\.error\) throw new Error\(r\.error\); return r\.data; \}, null, \{ quiet: true \}\)\) \{\s*S\.tdPlan = null; render\(\);/);
  assert.equal(a.split("S.tdPlan = null").length, 2, "外すのは成功のときだけ");
  assert.ok(a.includes("を今日の ${start}–${end} に入れました") && a.includes("r.warning ? `（${r.warning}）`"), a);
  assert.match(src, /function tdPlanDraft\(form, key\) \{[^]*?return \{ key, start: f\("start"\), minutes: \+f\("minutes"\) \};/);
});

test("ToDo タブ: S.tdPlan は clearSel・週の移動・render() の検証（タスクが無い）で外す。欄の change は S.tdPlan へ写す。フォーカスを保つ欄に tp", () => {
  assert.match(src, /const clearSel = \(\) => \{[^\n]*S\.tdPlan = null;/);
  assert.match(src, /function moveTodoWeek\(week\) \{[^}]*S\.tdPlan = null;/);
  assert.ok(src.includes("if (S.tdPlan && !S.data?.tasks.some((t) => t.id === S.tdPlan.key)) S.tdPlan = null;"));
  assert.ok(src.includes('if (el.dataset.tp !== undefined) {') && /key && key === S\.tdPlan\?\.key\) S\.tdPlan = tdPlanDraft\(form, key\)/.test(src));
  assert.ok(src.includes('for (const k of ["tdnote", "tf", "tdckadd", "tp", "ch"])'));
});

test("app.js: 画面の中の「＋ 突発タスク」は、開くだけで、欄外クリックの下書き外しに消されない", () => {
  assert.match(src, /!q\("\[data-urgent-open\],\[data-dragsess\]/, "欄外クリックの除外に入っている");
  const v = src.slice(src.indexOf('view.addEventListener("click"'));
  assert.ok(v.indexOf('q("[data-urgent-open]")') > 0 && v.indexOf('q("[data-urgent-open]")') < v.indexOf("let cleared = false"), "画面内のハンドラが、外す処理より先に開く");
  assert.match(src, /function openUrgent\(\) \{\s*if \(S\.screen === "todo" && S\.urgentDraft\)/, "開いていれば、そのまま残す");
});

test("app.js: ヘッダーの「＋ 突発タスク」は、画面の外のクリックの下書き外し（キャプチャ段階）に消されない", () => {
  const c = src.slice(src.indexOf('document.addEventListener("click"'));
  assert.ok(c.slice(0, c.indexOf("}, true);")).includes('if (e.target.closest("[data-delsel],[data-urgent-open],.fileinfo,[data-fileinfo]")) return;'), "キャプチャ段階の除外に入っている（ToDo タブで、打った入力を残すため）");
});

test("チェックの警告: 「未完了のまま」の選択肢（ckkeep）は無い。data-ckall だけが checkAll を立てる", () => {
  assert.ok(!src.includes("ckkeep"));
  const i = src.indexOf('q("[data-ckall]")'), a = src.slice(i, i + 500);
  assert.ok(i > 0 && a.includes("checkAll: true") && a.includes("setStatus(pd.id, pd.status, [], true)"), a);
});

// ヘッダーの札（読み込み中のファイル）。詳細の開閉は S.fileInfo で持ち、描き直しでも閉じない
test("app.js: filebar は renderFileChips で札を描き、「別の共有ファイル」の直書きは無い", () => {
  const line = src.split(/\r?\n/).find((l) => l.includes('$("filebar").innerHTML'));
  assert.ok(line, "filebar の描画行");
  assert.match(line, /renderFileChips\(S\.data, fileInfo\(\), S\.fileInfo\)/);
  assert.ok(!line.includes("別の共有ファイル") && !line.includes("別の個人ファイル"));
  assert.ok(!/data-open="(shared|personal)"[^>]*>別の/.test(line));
  const fn = src.slice(src.indexOf("function fileInfo()"), src.indexOf("function closeFileInfo"));
  assert.match(fn, /picker = typeof window\.showOpenFilePicker === "function"/);
  assert.match(fn, /writable: picker && /);
});

test("app.js: data-fileinfo のクリックで S.fileInfo を開閉する（同じ札なら閉じる）", () => {
  const m = src.match(/closest\("\[data-fileinfo\]"\)[^\n]*\n?[^\n]*/);
  assert.ok(m, "ハンドラ");
  assert.match(m[0], /S\.fileInfo = S\.fileInfo === [^;]+\? null :/);
});

test("app.js: Escape・画面の移動・data-open（ファイルを選ぶ）で S.fileInfo を閉じる", () => {
  const esc = src.slice(src.indexOf("/* ---------- キーボード"));
  assert.match(esc.slice(0, 800), /Escape" && S\.fileInfo\) \{ closeFileInfo\(\); return; \}/, "札の詳細を閉じたら return する（下書きを消す clearSel へ続けない）");
  const nav = src.slice(src.indexOf('document.querySelector("nav").addEventListener'), src.indexOf("function openUrgent"));
  assert.match(nav, /closeFileInfo\(\)/);
  const bar = src.slice(src.indexOf('$("filebar").addEventListener'), src.indexOf('$("banner").addEventListener'));
  assert.match(bar, /const pick = e\.target\.closest\("\[data-open\]"\);\s*\n\s*if \(pick\) \{ closeFileInfo\(\); openFile/);
});

test("app.js: 外を押したら閉じる。詳細の中・札は外として扱わず、閉じても描き直さない（打ちかけの入力を消さない）", () => {
  const cap = src.slice(src.indexOf('document.addEventListener("click", (e) => {') + 0, src.indexOf('view.addEventListener("click"'));
  assert.ok(cap.length > 0);
  assert.match(cap, /S\.fileInfo && !e\.target\.closest\("\.fileinfo,\[data-fileinfo\]"\)\) closeFileInfo\(\)/);
  assert.match(cap, /\[data-delsel\],\[data-urgent-open\],\.fileinfo,\[data-fileinfo\]/, "札を押しても、枠の選択・下書きを外さない");
  const fn = src.slice(src.indexOf("function closeFileInfo"), src.indexOf("function closeFileInfo") + 300);
  assert.ok(!fn.includes("render()"));
});

test("theme.css: ファイル情報の詳細は .filebar を基準に置く（札の右端に合わせると、幅の狭いとき画面の外へはみ出す）", () => {
  const css = readFileSync(new URL("../plugins/project-lens/src/ui/theme.css", import.meta.url), "utf8");
  assert.match(css, /.filebar{[^}]*position:relative/);
  assert.match(css, /.filechip{position:static/);
  const info = css.match(/.fileinfo{[^}]*}/);
  assert.ok(info, ".fileinfo の規則");
  assert.match(info[0], /position:absolute;left:0;top:100%/);
  assert.match(info[0], /width:min\(360px,100%\);max-width:100%/);
  assert.doesNotMatch(info[0], /right:0|100vw/);
});

test("今日の優先の「今日へ」（data-prioplan）は、ToDo タブへ移り、S.todoWeek を今週にして、そのあと openPlan を呼ぶ", () => {
  const i = src.indexOf('const pp = q("[data-prioplan]")');
  assert.ok(i > 0, "ハンドラ");
  const h = src.slice(i, src.indexOf("return; }", i));
  const a = h.indexOf('S.screen = "todo"'), b = h.indexOf("S.todoWeek = mondayOf(today)"), c = h.indexOf("openPlan(");
  assert.ok(a > 0 && b > a && c > b, h);
  assert.ok(h.includes("clearSel()") && h.indexOf("clearSel()") < c, "画面の移動で、ほかの入力欄を閉じてから開く");
  assert.ok(h.includes("S.resetScroll = true"), h);
});

test("ToDo タブ: 催促（data-chasedone・data-chaseedit）は S.tdChase を開き、S.tdOpen・S.tdPlan・S.urgentDraft を外す。逆に、ほかを開くと S.tdChase を外す", () => {
  assert.match(src, /tdPlan: null, tdChase: null/);
  const i = src.indexOf("function openChase("), a = src.slice(i, src.indexOf("\n}", i));
  assert.ok(i > 0, "開く処理");
  for (const s of ["S.tdChase = {", "S.tdOpen = null;", "S.tdPlan = null;", "S.urgentDraft = null;", "S.tdDraft = null;"]) assert.ok(a.includes(s), s);
  assert.match(src, /q\("\[data-chasedone\]"\)/);
  assert.match(src, /q\("\[data-chaseedit\]"\)/);
  assert.match(src, /const chd = q\("\[data-chasedone\]"\), che = q\("\[data-chaseedit\]"\);[^]*?mode = chd \? "done" : "edit"[^]*?else openChase\(id, mode\)/);
  assert.match(src, /const tdo = q\("\[data-tdopen\]"\);\s*if \(tdo\) \{[^\n]*S\.tdPlan = null; S\.tdChase = null;/);
  const j = src.indexOf("function openPlan(id)"); assert.ok(src.slice(j, src.indexOf("\n}", j)).includes("S.tdChase = null;"), "今日へ");
  const k = src.indexOf("function openUrgent()"); assert.ok(src.slice(k, src.indexOf("\n}", k)).includes("clearSel();"), "突発は clearSel で外す");
  assert.match(src, /plan: S\.tdPlan, chase: S\.tdChase, urgentDraft: S\.urgentDraft/);
});

test("ToDo タブ: 催促の保存（data-chasesave）は、先に S.tdChase へ写してから apply する。待ち先が空なら throw。成功のときだけ外す", () => {
  const i = src.indexOf('const chs = q("[data-chasesave]")'), a = src.slice(i, src.indexOf('q("[data-chasecancel]")', i));
  assert.ok(i > 0, "ハンドラ");
  const w = a.indexOf("S.tdChase = tdChaseDraft("), ap = a.indexOf("apply(");
  assert.ok(w > 0 && ap > w, "写すのが先");
  assert.ok(a.includes("markChased(d, id,") && a.includes("updateTask(d, id, { waitingOn:"), a);
  assert.ok(/throw new Error\("待ち先を入力してください"\)/.test(a), "空は throw");
  assert.match(a, /\)\) \{\s*S\.tdChase = null; render\(\);/);
  assert.equal(a.split("S.tdChase = null").length, 2, "外すのは成功のときだけ");
  assert.match(src, /function tdChaseDraft\(form, key, mode\) \{[^]*?return \{ key, mode, days:/);
  assert.match(src, /q\("\[data-chasecancel\]"\)\) \{ S\.tdChase = null; render\(\); return; \}/);
});

test("ToDo タブ: S.tdChase は clearSel・週の移動・render() の検証（催促の対象でなくなった）で外す。欄の change は S.tdChase へ写す。フォーカスを保つ欄に ch", () => {
  assert.match(src, /const clearSel = \(\) => \{[^\n]*S\.tdChase = null;/);
  assert.match(src, /function moveTodoWeek\(week\) \{[^}]*S\.tdChase = null;/);
  assert.ok(src.includes("if (S.tdChase && !chaseTasks(S.data, clock().date).some((r) => r.task.id === S.tdChase.key)) S.tdChase = null;"));
  assert.ok(src.includes("if (el.dataset.ch !== undefined) {") && /key === S\.tdChase\?\.key\) S\.tdChase = tdChaseDraft\(form, key, S\.tdChase\.mode\)/.test(src));
  assert.ok(src.includes('for (const k of ["tdnote", "tf", "tdckadd", "tp", "ch"])'));
});
