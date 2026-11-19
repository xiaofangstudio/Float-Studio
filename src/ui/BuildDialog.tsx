/* 「编译成文件」：一站式可视化编译。
 *
 * 一张面板里做三件事：
 *   1. 选要编译哪些界面（每个 .cui 是一个软件）；
 *   2. 排先后（第一个是主软件，放输出根目录，其余进 apps/）；
 *   3. 选输出位置与产物形态（独立软件 / 单文件网页）。
 */

import React, { useEffect, useMemo, useState } from 'react';

export type BuildTarget = {
  /** 工程内相对路径，如 app/todo.cui */
  rel: string;
  /** 当前缓冲区内容（编译看到的必须是屏幕上这份） */
  text: string;
  /** 是否是 project.json 里指定的入口 */
  isEntry: boolean;
};

export type BuildKind = 'app' | 'html';

export type BuildOptions = {
  order: { rel: string; text: string }[];
  outDir: string;
  kind: BuildKind;
};

export type BuildProgressState = { percent: number; label: string; note?: string };

export type BuildDialogProps = {
  open: boolean;
  targets: BuildTarget[];
  busy: boolean;
  progress: BuildProgressState | null;
  onClose: () => void;
  onPickDir: () => Promise<string | null>;
  onStart: (opts: BuildOptions) => Promise<void>;
};

function stem(rel: string): string {
  const base = rel.replace(/\\/g, '/').split('/').pop() ?? rel;
  return base.replace(/\.cui$/i, '');
}

export function BuildDialog(p: BuildDialogProps): React.ReactElement | null {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [outDir, setOutDir] = useState('');
  const [kind, setKind] = useState<BuildKind>('app');
  const [err, setErr] = useState('');

  /* 每次打开都按当前工程重置：入口默认勾上，排最前 */
  useEffect(() => {
    if (!p.open) return;
    const entry = p.targets.find((t) => t.isEntry) ?? p.targets[0];
    const next: Record<string, boolean> = {};
    for (const t of p.targets) next[t.rel] = t.rel === entry?.rel;
    setChecked(next);
    setOrder(p.targets.map((t) => t.rel));
    setOutDir('');
    setKind('app');
    setErr('');
  }, [p.open, p.targets]);

  const picked = useMemo(
    () => order.filter((rel) => checked[rel] && p.targets.some((t) => t.rel === rel)),
    [order, checked, p.targets]
  );
  const main = picked[0] ?? '';

  const move = (rel: string, delta: number): void => {
    setOrder((cur) => {
      const i = cur.indexOf(rel);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = cur.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  if (!p.open) return null;

  const pickDir = async (): Promise<void> => {
    const dir = await p.onPickDir();
    if (dir) setOutDir(dir);
  };

  const start = async (): Promise<void> => {
    setErr('');
    if (picked.length === 0) { setErr('至少要勾一个界面'); return; }
    if (!outDir) { setErr('先选一个输出位置'); return; }
    const rows = picked
      .map((rel) => p.targets.find((t) => t.rel === rel))
      .filter((t): t is BuildTarget => !!t)
      .map((t) => ({ rel: t.rel, text: t.text }));
    await p.onStart({ order: rows, outDir, kind });
  };

  return (
    <div className="build-dialog-mask" role="dialog" aria-label="编译成文件">
      <div className="build-dialog">
        <div className="build-dialog-head">
          <div>
            <div className="build-dialog-title">编译成文件</div>
            <div className="build-dialog-sub">选要编译的界面、排先后、定输出位置</div>
          </div>
          <button className="build-dialog-x" onClick={p.onClose} disabled={p.busy} aria-label="关闭">×</button>
        </div>

        <div className="build-dialog-section">
          <div className="build-dialog-label">
            编译哪些界面
            <span className="build-dialog-count">{picked.length} / {p.targets.length}</span>
          </div>
          <div className="build-dialog-list">
            {p.targets.length === 0 && <div className="build-dialog-empty">这个工程里还没有 .cui 界面</div>}
            {order.map((rel) => {
              const t = p.targets.find((x) => x.rel === rel);
              if (!t) return null;
              const isMain = rel === main;
              return (
                <div className={`build-target ${checked[rel] ? 'on' : ''}`} key={rel}>
                  <label className="build-target-check">
                    <input
                      type="checkbox"
                      checked={!!checked[rel]}
                      disabled={p.busy}
                      onChange={(e) => setChecked((c) => ({ ...c, [rel]: e.target.checked }))}
                    />
                    <span className="build-target-name">{stem(rel)}</span>
                    {t.isEntry && <span className="build-target-tag">入口</span>}
                    {isMain && <span className="build-target-tag main">主软件</span>}
                  </label>
                  <span className="build-target-path">{rel}</span>
                  <span className="build-target-order">
                    <button onClick={() => move(rel, -1)} disabled={p.busy} title="上移">↑</button>
                    <button onClick={() => move(rel, 1)} disabled={p.busy} title="下移">↓</button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="build-dialog-section">
          <div className="build-dialog-label">输出位置</div>
          <div className="build-dialog-dir">
            <span className="build-dialog-path">{outDir || '还没选'}</span>
            <button onClick={() => void pickDir()} disabled={p.busy}>选择目录…</button>
          </div>
        </div>

        <div className="build-dialog-section">
          <div className="build-dialog-label">产物形态</div>
          <div className="build-kind">
            <button
              className={`build-kind-btn ${kind === 'app' ? 'on' : ''}`}
              onClick={() => setKind('app')}
              disabled={p.busy}
            >
              <b>独立软件</b>
              <span>index.html + 启动器 exe，双击即开，srv 后端跟着跑</span>
            </button>
            <button
              className={`build-kind-btn ${kind === 'html' ? 'on' : ''}`}
              onClick={() => setKind('html')}
              disabled={p.busy}
            >
              <b>单文件网页</b>
              <span>只有一个 index.html，断网也能开（无后端）</span>
            </button>
          </div>
        </div>

        {p.busy && p.progress && (
          <div className="build-dialog-progress">
            <div className="build-modal-bar">
              <div className="build-modal-fill" style={{ width: `${p.progress.percent}%` }} />
            </div>
            <div className="build-modal-row">
              <span>{p.progress.label}</span>
              <span className="build-modal-pct">{p.progress.percent}%</span>
            </div>
            {p.progress.note && <div className="build-modal-note">{p.progress.note}</div>}
          </div>
        )}

        {err && <div className="build-dialog-err">{err}</div>}

        <div className="build-dialog-foot">
          <button onClick={p.onClose} disabled={p.busy}>取消</button>
          <button className="primary" onClick={() => void start()} disabled={p.busy || picked.length === 0}>
            {p.busy ? '编译中…' : '开始编译'}
          </button>
        </div>
      </div>
    </div>
  );
}
