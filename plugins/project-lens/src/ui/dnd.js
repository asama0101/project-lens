// ドラッグ&ドロップの「どこへ落とすと何が起きるか」の判断。DOM には触れない（落とし先の読み取りは app.js）。データは変えない。
import { toMin, toHHMM } from "../core/dates.js";
import { allSessions, ownerOf, addSession, moveSession } from "../core/sessions.js";
import { updateMeeting } from "../core/schedule.js";
import { moveTask, moveChecklistItem } from "./edit.js";
import { snapStart } from "./views/schedule.js";
import { fmtMD, hm } from "./common.js";

/** { data, error } を返す編集関数を、apply に渡せる形（data → data）にする */
export const asEdit = (fn) => (d) => { const r = fn(d); if (r.error) throw new Error(r.error); return r.data; };

/**
 * 枠・会議・タスクのドロップ先の判定。drag: { kind: "mtg" | "sess" | "task", id }。date: 落とす日、at: 落とした位置の時刻（分）。
 * 戻り値: { st, end, error?, warning, next（data → data）, msg }
 */
export function planDropAt(data, drag, { date, at }, now) {
  if (drag.kind === "mtg") {
    const m = data.events.find((o) => o.id === drag.id), dur = toMin(m.end) - toMin(m.start), st = snapStart(at, dur);
    const clash = allSessions(data).some((s) => s.date === date && toMin(s.start) < st + dur && toMin(s.end) > st);
    return { st, end: st + dur, warning: clash ? "配置済みの枠と重なっています" : "", next: (d) => updateMeeting(d, m.id, { date, start: toHHMM(st), end: toHHMM(st + dur) }), msg: `会議「${m.title}」を ${fmtMD(date)} ${hm(st)} に移動しました` };
  }
  if (drag.kind === "sess") {
    const s = allSessions(data).find((x) => x.id === drag.id), dur = toMin(s.end) - toMin(s.start), st = snapStart(at, dur);
    const to = { date, start: toHHMM(st) };
    const r = moveSession(data, s.id, to, now);
    return { st, end: st + dur, error: r.error, warning: r.warning, next: asEdit((d) => moveSession(d, s.id, to, now)), msg: `${s.title} を ${fmtMD(date)} ${hm(st)} に移動しました` };
  }
  const st = snapStart(at, 60);
  const did = drag.id, put = { date, start: toHHMM(st), end: toHHMM(st + 60) };
  const r = addSession(data, did, put);
  return { st, end: st + 60, error: r.error, warning: r.warning, next: asEdit((d) => addSession(d, did, put)), msg: `${ownerOf(data, did).item.title} を ${fmtMD(date)} ${hm(st)} に予定として配置しました` };
}

/**
 * タスクの並べ替えの落とし先。rows: 同じ親の行を上から順に並べた { id, pid, g, sg }（タスク行は id、見出し行は pid と g・sg を持つ）。
 * i: 落とした行の位置、upper: 行の上半分に落としたか。moveTask に渡す指定（pos つき）を返す。落とせない・動かないときは null
 */
export function planOrderAt(data, dragId, rows, i, upper) {
  const here = rows[i];
  const dragged = data.tasks.find((t) => t.id === dragId);
  const target = here.id ? data.tasks.find((t) => t.id === here.id) : null;
  const pid = target ? target.projectId : here.pid;
  if (!dragged || !pid || pid !== dragged.projectId) return null;
  // その行より下で、同じセクションの先頭のタスク行（見出しに当たったらなし）
  const nextTaskId = () => { for (const r of rows.slice(i + 1)) { if (r.id) return r.id; if (r.pid) return null; } return null; };
  let plan;
  if (target) {
    plan = upper
      ? { beforeId: target.id, pos: "before" }
      : { beforeId: nextTaskId(), group: target.group ?? "", subgroup: target.subgroup ?? "", pos: "after" };
  } else {
    plan = { beforeId: nextTaskId(), group: here.g, subgroup: here.sg, pos: "after" }; // 見出しへ落とすと、そのセクションの先頭
  }
  if (moveTask(data, dragId, plan) === data) return null;
  return plan;
}

/**
 * チェックリストの項目の落とし先。ckIds: 同じタスクの項目 ID を上から順に並べたもの、i: 落とした項目の位置、upper: 上半分か。
 * 上半分ならその前、下半分なら次の項目の前（なければ末尾）。動かない・落とせないときは null
 */
export function planCkOrderAt(data, tid, iid, ckIds, i, upper) {
  const beforeId = upper ? ckIds[i] : (ckIds[i + 1] ?? null);
  if (beforeId === iid || moveChecklistItem(data, tid, iid, beforeId) === data) return null;
  return { beforeId, pos: upper ? "before" : "after" };
}
