// 保存と読み直しの順序づけ。画面の編集（data → data）を、他（Claude Code など）の更新と競合したら最新のファイルに当て直して保存し、
// 他の更新を定期的に読み直す。保存と読み直しは 1 本の列（chain）に並べ、古い内容で上書きしない。DOM には触れず、描画・通知は deps で受ける。
const CONFLICT ="他で更新されました。再読込してください。(再読込すると、保存できていない画面の変更は消えます)";

/**
 * deps: { store, getData, setData, render, renderBar, banner, toast, visible, wantFast, isEditing }
 *   visible: 画面が見えているか（隠れている間は読み直さない）/ wantFast: 帯が開いているか（4 秒ごとに読み直す。そうでなければ 16 秒ごと）
 *   isEditing: 入力欄で打ちかけ（まだ確定していない）か。真の間、読み直しはデータだけ取り込み、描き直しを flush まで待たせる（描き直すと打ちかけの文字が消えるため）
 * 戻り値: { persist(edit), pollInbox(force), flush(), rendered(), whenIdle(), reset(), failed }。failed は保存に失敗したまま（バナーが出ている）か
 */
export function createSync({ store, getData, setData, render, renderBar, banner, toast, visible, wantFast, isEditing = () => false }) {
  let chain = Promise.resolve();
  let renderLater = false; // 打ちかけの間に待たせた描き直しがある
  const renderOrWait = () => { if (isEditing()) renderLater = true; else render(); };
  let pending = []; // 保存がまだ済んでいない編集（data → data）。競合したとき、最新のファイルに当て直す
  let inflight = 0; // 保存・読み直しの待ち・実行中の数
  let tick = 0;

  const sync = {
    failed: false,
    /** 編集を保存する。競合したら、最新のファイルに、まだ保存していない編集をすべて当て直して保存する */
    persist(edit) {
      pending.push(edit);
      inflight++;
      chain = chain.then(async () => {
        try {
          if (!store.hasFile) { banner("このブラウザでは直接保存できません。変更は「JSON を書き出す」で保存してください。", { download: true }); return; }
          const edits = pending.slice();
          const r = await store.saveMerged((d) => edits.reduce((acc, e) => e(acc), d), getData());
          if (r.ok) {
            pending = pending.filter((e) => !edits.includes(e));
            if (r.data !== getData()) { // 最新のファイルに当て直して保存した。あとから足された編集を、その上に重ねて、画面に出す
              setData(r.data);
              try { setData(pending.reduce((acc, e) => e(acc), r.data)); } catch { pending = []; toast("他の更新と重なったため、直前の操作は反映されませんでした"); }
              render();
            }
            const recovered = sync.failed;
            sync.failed = false;
            if (recovered) banner(""); // 失敗の印を下ろしてから。画面は、空の文を「検証の結果を出し直す」と読む
            return;
          }
          sync.failed = true;
          banner(r.reason === "conflict" ? CONFLICT : r.message, { reload: r.reason === "conflict", download: true });
        } finally { inflight--; }
      });
    },
    /** ファイルを読み直して、他の更新（受け取り・提案・見ている印）を画面に出す。保存と同じ列に並べる（読んでいる間に済んだ保存を、古い内容で上書きしないように） */
    pollInbox(force = false) {
      const data = getData();
      if (!data || !store.hasFile || !visible()) return;
      const busy = (data.inbox?.requests ?? []).some((r) => ["pending", "working", "question", "proposed"].includes(r.status));
      if (!force && !wantFast() && !busy && ++tick % 4 !== 0) return;
      if (sync.failed || inflight || pending.length) return;
      inflight++;
      chain = chain.then(async () => {
        try {
          if (sync.failed || pending.length) return; // 並んでいる間に編集があった。その保存を先にする
          const strip = (d) => JSON.stringify({ ...d, inbox: undefined });
          const probe = await store.peek(); // 読むだけ（読み込んだことにしない）。他の更新があるときだけ、読み込み直す
          if (JSON.stringify(probe) === JSON.stringify(getData())) { renderBar(); return; }
          const fresh = await store.reload();
          if (pending.length) { // 読んでいる間に、画面で編集があった。最新のファイルの上に重ねる（保存は、その編集の保存が行う）
            try { setData(pending.reduce((d, e) => e(d), fresh)); } catch { sync.failed = true; banner(CONFLICT, { reload: true, download: true }); return; }
            renderOrWait();
            return;
          }
          const bodyChanged = strip(fresh) !== strip(getData());
          setData(fresh);
          if (bodyChanged) renderOrWait(); else renderBar();
        } catch { /* 読めないときは、次の回に */ } finally { inflight--; }
      });
    },
    /** 待たせた描き直しを、打ちかけでなくなっていれば行う（画面が、入力欄の確定・フォーカスが離れたときに呼ぶ） */
    flush() { if (renderLater && !isEditing()) { renderLater = false; render(); } },
    /** 画面がほかの理由で描き直した: 待たせた描き直しは要らない */
    rendered() { renderLater = false; },
    /** 並んでいる保存・読み直しが終わるまで待つ */
    whenIdle: () => chain,
    /** ファイルを開き直したとき: 保存していない編集を捨て、失敗の印を消す */
    reset() { pending = []; sync.failed = false; renderLater = false; },
  };
  return sync;
}
