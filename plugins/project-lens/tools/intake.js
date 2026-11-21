// 使い方: node tools/intake.js <コマンド> <data.json> ...   （コマンドの一覧は引数なしで実行すると出る）
// 取り込み（WBS・予定表）と、会議のプロジェクト規則、WBS の列の対応を扱う。結果は JSON で標準出力へ。
// *-plan・*-list・*-get は data.json を書かない。*-apply・*-set・*-remove は検証に通ったときだけ書く。
import { createHash } from "node:crypto";
import { today, isDate, nowLocal } from "../src/core/dates.js";
import { readJson, out, save } from "./cli.js";
import { assignMeetingProjects, setProjectRule, removeProjectRule } from "../src/core/rules.js";
import { planWbsImport, applyWbsImport, getWbsMapping, setWbsMapping } from "../src/import/wbs.js";
import { planCalendarSync, planAutoSync } from "../src/import/calendar.js";
import { readMcpConfig, validateMcpConfig } from "../src/import/mcpconf.js";
import { takeData, pickHome } from "./home.js";

const USAGE = `使い方: node tools/intake.js <コマンド> <data.json> ...
  wbs-plan | wbs-apply   <data.json> <projectId> <rows.json> [--source <取り込んだファイル名>] [--plan-key <planKey>]   (--source は wbs-apply の取り込み記録用。--plan-key は wbs-apply だけ。wbs-plan が出す planKey を渡すと、承認した変更案と違うとき、書かずに止める)
  calendar-auto                  <data.json> <fetched.json> <開始日> <終了日> [--data <置き場>]   (自動更新。見張りと /project-lens:intake calendar が使う。承認の確認なしで書く。終わった会議・確認済みの会議は変えず、取得が 0 件、または取得に無い会議が多すぎる（3 件以上で、終わっていない取り込み済みの半数超）なら消さない)
  calendar-plan | calendar-apply <data.json> <fetched.json> <開始日> <終了日> [--data <置き場>]   (--data は、自分のメールアドレスなどの設定（project-lens-mcp.json）の置き場。環境変数 PROJECT_LENS_HOME が優先)
  rules-list | rules-apply <data.json>
  rules-set              <data.json> <keyword> <projectId>
  rules-remove           <data.json> <keyword>
  mapping-get            <data.json> <projectId>
  mapping-set            <data.json> <projectId> <mapping.json>`;

const usage = () => { console.error(USAGE); process.exit(2); };

/** 変更案（追加と更新）の指紋。承認した案と、書く時点の案が同じかを、wbs-apply が確かめるために使う */
const planKey = (plan) => createHash("sha256").update(JSON.stringify({ add: plan.add, update: plan.update })).digest("hex").slice(0, 16);

// コマンド名 → [必要な引数の数(コマンド名を除く), 実行]
const COMMANDS = {
  "wbs-plan": [3, (d, [, pid, rows]) => { const plan = planWbsImport(d, pid, readJson(rows)); out({ ...plan, planKey: planKey(plan) }); }],
  "wbs-apply": [3, (d, [path, pid, rows], o) => {
    const plan = planWbsImport(d, pid, readJson(rows));
    if (o.planKey != null && o.planKey !== planKey(plan)) throw new Error("承認した変更案と、いまのデータでの変更案が違います（承認を待つ間に、データか rows.json が変わりました）。何も書いていません。wbs-plan をやり直して、確認を取ってください");
    save(path, applyWbsImport(d, pid, plan, { today: today(), source: o.source }));
    out({ ok: true, summary: { added: plan.add.length, updated: plan.update.length }, rejected: plan.rejected, warnings: plan.warnings });
  }],
  "calendar-plan": [4, (d, [, f, s, e], o) => {
    const { added, updated, removed, excluded, warnings } = planCalendarSync(d, readJson(f), { start: s, end: e }, o.calendar);
    const gone = new Set(excluded.map((e) => e.externalId));
    const removedByExclusion = removed.filter((e) => gone.has(e.externalId)).map((e) => ({ id: e.id, title: e.title, date: e.date, confirmed: !!e.confirmed })); // 対象外になって消える取り込み済みの会議。確認済みの実績も消えるので、承認の前に見せる
    out({ added, updated, removed, excluded: excluded.map(({ externalId, title, date, start, end }) => ({ externalId, title, date, start, end })), removedByExclusion, warnings }); // 参加者（メールアドレス）は出さない
  }],
  "calendar-apply": [4, (d, [path, f, s, e], o) => {
    const plan = planCalendarSync(d, readJson(f), { start: s, end: e }, o.calendar);
    save(path, plan.data); // 検証は save が行う
    out({ ok: true, summary: { added: plan.added.length, updated: plan.updated.length, removed: plan.removed.length, excluded: plan.excluded.length }, warnings: plan.warnings });
  }],
  "calendar-auto": [4, (d, [path, f, s, e], o) => {
    const plan = planAutoSync(d, readJson(f), { start: s, end: e }, o.calendar, nowLocal());
    save(path, plan.data); // 検証は save が行う
    out({ ok: true, summary: { added: plan.added.length, updated: plan.updated.length, removed: plan.removed.length, excluded: plan.excluded.length, held: plan.held.length }, held: plan.held, blocked: plan.blocked, warnings: plan.warnings });
  }],
  "rules-list": [1, (d) => out(d.settings?.projectRules ?? [])],
  "rules-apply": [1, (d, [path]) => { save(path, assignMeetingProjects(d)); out({ ok: true }); }],
  "rules-set": [3, (d, [path, k, pid]) => { save(path, setProjectRule(d, k, pid)); out({ ok: true }); }],
  "rules-remove": [2, (d, [path, k]) => { save(path, removeProjectRule(d, k)); out({ ok: true }); }],
  "mapping-get": [2, (d, [, pid]) => out(getWbsMapping(d, pid))],
  "mapping-set": [3, (d, [path, pid, m]) => { save(path, setWbsMapping(d, pid, readJson(m))); out({ ok: true }); }],
};

const { data: dataArg, rest: argv } = takeData(process.argv.slice(2));
const take = (flag) => { const i = argv.indexOf(flag); if (i < 0) return undefined; const v = argv[i + 1] ?? null; argv.splice(i, 2); return v; }; // 無ければ undefined、値が無ければ null
const planKeyArg = take("--plan-key");
if (planKeyArg === null) usage(); // 値の取り損ねで、照合を黙って省かない
const opts = { source: take("--source") ?? null, planKey: planKeyArg ?? null }; // source: wbs-apply の取り込み記録に残す、取り込んだファイル名
const [cmd, ...args] = argv;
const spec = COMMANDS[cmd];
if (!spec || args.length < spec[0]) usage();
if (cmd.startsWith("calendar-") && !(isDate(args[2]) && isDate(args[3]))) usage();
try {
  if (cmd.startsWith("calendar-")) { // 自分だけの予定を除く設定
    const home = pickHome(dataArg);
    opts.calendar = home ? readMcpConfig(home).calendar : undefined;
    const errors = opts.calendar ? validateMcpConfig({ calendar: opts.calendar }) : [];
    if (errors.length) throw new Error(`project-lens-mcp.json の指定が正しくありません: ${errors.join(" / ")}`);
  }
  spec[1](readJson(args[0]), args, opts);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
