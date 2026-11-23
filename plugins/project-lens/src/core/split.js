// 1 つのデータ（メモリ上の形）と、共有ファイル（data.json）・個人ファイル（personal.json）の間の変換。純関数。
// 入力は変えず、新しいオブジェクトを返す。

export const PERSONAL_SETTINGS = ["workday", "holidays", "workdays", "selfEmails", "selfNames"];
export const SHARED_SETTINGS = ["countWeekendsAndHolidays", "nationalHolidays", "waitingLongDays", "projectRules", "labels", "wbsMappings", "wbsImports"];

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

/** 共有ファイルと個人ファイルへ分ける。共有の設定は、個人の設定のキー以外すべて（未知のキーも共有） */
export function splitData(data) {
  const { tasks, events, inbox, settings = {}, orphanSessions, ...rest } = data;
  const sessions = [];
  const sharedTasks = (tasks ?? []).map(({ sessions: ss, ...t }) => {
    for (const s of ss ?? []) sessions.push({ ...s, taskId: t.id });
    return t;
  });
  for (const s of orphanSessions ?? []) sessions.push({ ...s });
  const personalSettings = pick(settings, PERSONAL_SETTINGS);
  const sharedSettings = Object.fromEntries(Object.entries(settings).filter(([k]) => !PERSONAL_SETTINGS.includes(k)));
  const shared = { ...rest, tasks: sharedTasks, settings: sharedSettings };
  const personal = { version: data.version, sessions, events: events ?? [], settings: personalSettings, ...(inbox !== undefined ? { inbox } : {}) };
  return { shared, personal };
}

/** 2 つのファイルを 1 つのデータへ戻す。共有に無い taskId の枠は orphanSessions に入れる */
export function mergeData(shared, personal) {
  const ids = new Set(shared.tasks.map((t) => t.id));
  const byTask = new Map();
  const orphans = [];
  for (const s of personal.sessions ?? []) {
    const { taskId, ...session } = s;
    if (!ids.has(taskId)) { orphans.push({ ...session, taskId }); continue; }
    if (!byTask.has(taskId)) byTask.set(taskId, []);
    byTask.get(taskId).push(session);
  }
  const { inbox, events } = personal;
  return {
    ...shared,
    tasks: shared.tasks.map((t) => ({ ...t, sessions: byTask.get(t.id) ?? [] })),
    events: events ?? [],
    settings: { ...(shared.settings ?? {}), ...(personal.settings ?? {}) },
    ...(inbox !== undefined ? { inbox } : {}),
    ...(orphans.length ? { orphanSessions: orphans } : {}),
  };
}

export function removeOrphanSessions(data) {
  return { ...data, orphanSessions: [] };
}

export function emptyPersonal() {
  return { version: 1, sessions: [], events: [], settings: {} };
}

const checkShape = (x, name, keys) => {
  for (const k of keys) if (!Array.isArray(x?.[k])) throw new Error(`${name}のデータの形が違います（${k} がありません）`);
};
export const checkSharedShape = (x) => checkShape(x, "data.json", ["projects", "tasks", "changeLog"]);
export const checkPersonalShape = (x) => checkShape(x, "personal.json", ["sessions", "events"]);
