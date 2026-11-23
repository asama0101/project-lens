import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFS, loadPrefs, savePrefs, loadInboxDraft, saveInboxDraft } from "../plugins/project-lens/src/ui/prefs.js";

const fake = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m };
};
const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

test("loadPrefs: 保存が無い／壊れたJSON／getItem が例外を投げるとき、既定を返す", () => {
  assert.deepEqual(loadPrefs(fake()), DEFAULT_PREFS);
  assert.deepEqual(loadPrefs(fake({ "project-lens.prefs": "{oops" })), DEFAULT_PREFS);
  assert.deepEqual(loadPrefs(boom), DEFAULT_PREFS);
  assert.deepEqual(loadPrefs(null), DEFAULT_PREFS);
  assert.deepEqual(DEFAULT_PREFS, { showPrio: true, showActual: true, showSkipped: false, showDue: true }); // スケジュールの期限の行は、初めは開いている
});

test("loadPrefs: 保存された値だけを使い、真偽値以外や未知のキーは無視する", () => {
  const s = fake({ "project-lens.prefs": JSON.stringify({ showPrio: false, showActual: "no", other: 1 }) });
  assert.deepEqual(loadPrefs(s), { showPrio: false, showActual: true, showSkipped: false, showDue: true });
});

test("savePrefs→loadPrefs で往復でき、setItem が例外を投げても落ちない", () => {
  const s = fake();
  savePrefs({ showPrio: false, showActual: false, showSkipped: true, showDue: false }, s);
  assert.deepEqual(loadPrefs(s), { showPrio: false, showActual: false, showSkipped: true, showDue: false });
  assert.doesNotThrow(() => savePrefs({ showPrio: true, showActual: true, showSkipped: false }, boom));
});

test("loadInboxDraft / saveInboxDraft: 依頼の下書きを往復でき、無い・壊れた・storage が使えないときは空。保存の失敗で落ちない", () => {
  const s = fake();
  assert.equal(loadInboxDraft(s), "");
  saveInboxDraft("AA-0003 が 5 日遅れた\n次の行", s);
  assert.equal(loadInboxDraft(s), "AA-0003 が 5 日遅れた\n次の行");
  saveInboxDraft("", s);
  assert.equal(loadInboxDraft(s), "");
  assert.equal(loadInboxDraft(boom), "");
  assert.equal(loadInboxDraft(null), "");
  assert.doesNotThrow(() => saveInboxDraft("x", boom));
});

// ---- 設定タブの節の開閉の保存 ----
import { SETTINGS_FOLDS, loadSettingsClosed, saveSettingsClosed } from "../plugins/project-lens/src/ui/prefs.js";

test("loadSettingsClosed: 保存が無い・壊れている・形が違う・storage が使えないときは、閉じている節なし（すべて開く）", () => {
  assert.deepEqual(loadSettingsClosed(fake()), []);
  assert.deepEqual(loadSettingsClosed(fake({ "project-lens.settingsClosed": "{oops" })), []);
  assert.deepEqual(loadSettingsClosed(fake({ "project-lens.settingsClosed": JSON.stringify({ basic: true }) })), []);
  assert.deepEqual(loadSettingsClosed(boom), []);
  assert.deepEqual(loadSettingsClosed(null), []);
});

test("loadSettingsClosed: 節の ID だけを採用し、順序は SETTINGS_FOLDS に揃える", () => {
  const s = fake({ "project-lens.settingsClosed": JSON.stringify(["wbs", "x", 5, "basic", "wbs"]) });
  assert.deepEqual(loadSettingsClosed(s), ["basic", "wbs"]);
  assert.deepEqual(SETTINGS_FOLDS, ["basic", "days", "nat", "hol", "wrk", "rules", "wbs"]);
});

test("saveSettingsClosed→loadSettingsClosed で往復でき、保存できなくても落ちない", () => {
  const s = fake();
  saveSettingsClosed(["hol", "rules"], s);
  assert.deepEqual(loadSettingsClosed(s), ["hol", "rules"]);
  assert.doesNotThrow(() => saveSettingsClosed(["hol"], boom));
});
