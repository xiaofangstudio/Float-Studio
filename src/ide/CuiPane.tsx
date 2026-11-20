/* 工程里的 Copper UI 工作台：左边预览（能点、能操作），右边/下面是属性检查器。
 *
 * 三件事在这里合上：
 *  1. 编译：TS 编译器在本地跑，一份 AST 同时喂给编译与建树（大文件不再重复解析）；
 *  2. 互动：把 `when click` + `act` 编译出来的 behaviors 挂到 iframe 上，点一下真的会动；
 *     act call 会调 app/*.co 里的 Copper 函数（page.* 操作预览里的界面）；
 *  3. 可视化编辑：点预览里的元素 → 选中对应规则 → 改个值 → 源码自己更新。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compileDocument } from '@fangui/cui/compile';
import { parseCui } from '@fangui/cui/parser';
import { buildCuiTree, renderCuiTree } from '@fangui/cui/tree';
import { attachCuiRuntime } from '@fangui/cui/runtime';
import { findRuleForPick, valueText, type CuiPick } from './patch';
import { BASE_CSS, TOKEN_CSS } from '@fangui/cui/sample';
import { api, isTauriEnv } from '../core/tauri';
import type { CopperEnvInfo } from '../core/tauri';
import { callCopperFn, createPageBridge, selectorOfHit, setPageBridge } from '@fangui/lang/pagehost';

export type CuiPaneProps = {
  /** 当前 .cui 缓冲区里的文本 */
  code: string;
  /** 前端 Copper 逻辑（app/*.co，工程相对路径 → 源码）；act call 调这里的函数 */
  preview?: { logic?: Record<string, string> };
  /** 预览结构变了（换文件）就重建 iframe */
  frameKey?: string;
  /** 检查器改了属性：把这一行写回源码 */
  onPatch?: (pick: CuiPick, prop: string, value: string) => void;
};

/** 检查器里能直接改的属性：都是最常用的那几个，不是全部 */
const INSPECT_PROPS: { prop: string; label: string; hint: string }[] = [
  { prop: 'background', label: '背景', hint: 'accent / #ffffff' },
  { prop: 'color', label: '文字色', hint: 'ink' },
  { prop: 'radius', label: '圆角', hint: '10' },
  { prop: 'padding', label: '内边距', hint: '8 16' },
  { prop: 'size', label: '字号', hint: '13' },
  { prop: 'weight', label: '字重', hint: 'bold' }
];

function pickLabel(p: CuiPick): string {
  const parts: string[] = [];
  if (p.tag) parts.push(p.tag);
  if (p.id) parts.push('#' + p.id);
  for (const c of p.cls.split(/\s+/)) {
    if (c && c !== 'selected') parts.push('.' + c);
  }
  return parts.join(' ') || '元素';
}

export function CuiPane({ code, preview, frameKey, onPatch }: CuiPaneProps): React.ReactElement {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const docRef = useRef<Document | null>(null);
  const hlRef = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [pick, setPick] = useState<CuiPick | null>(null);
  const [toast, setToast] = useState('');
  const [env, setEnv] = useState<CopperEnvInfo | null>(null);

  /* Copper 归环境：进来先问一次"接的是哪一版"，缺失就明说，不静默假装有编译。 */
  useEffect(() => {
    if (!isTauriEnv()) return;
    let alive = true;
    void api.copperEnvInfo().then((v) => { if (alive) setEnv(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  /* 大工程的关键：一次解析，编译与建树共用同一份 AST。
   * 以前每敲一个字要 parse 两次、compile 一次、build 一次；400KB 的 .cui 会掉帧。
   * 合并渲染：不是等停手才画，而是把这一小段时间内的多次输入并成一次重算——
   * 普通文件最多 48ms 一批，超过 200KB 的文件最多 120ms 一批，边敲边更新，
   * 也不会每敲一个字就把整个预览重建一遍。 */
  const [heavyCode, setHeavyCode] = useState(code);
  const latestCode = useRef(code);
  const renderTimer = useRef<number | null>(null);
  const lastRender = useRef(0);
  useEffect(() => {
    latestCode.current = code;
    if (renderTimer.current !== null) return; // 已经排好一批，后来的输入并进去
    const gap = code.length > 200_000 ? 120 : 48;
    const wait = Math.max(0, gap - (performance.now() - lastRender.current));
    renderTimer.current = window.setTimeout(() => {
      renderTimer.current = null;
      lastRender.current = performance.now();
      setHeavyCode(latestCode.current);
    }, wait);
  }, [code]);
  useEffect(() => () => {
    if (renderTimer.current !== null) window.clearTimeout(renderTimer.current);
  }, []);
  const doc = useMemo(() => parseCui(heavyCode), [heavyCode]);
  const result = useMemo(() => compileDocument(doc), [doc]);

  /* 界面结构由 .cui 自己长出来：一条规则 = 一个元件。 */
  const tree = useMemo(() => buildCuiTree(doc), [doc]);
  const treeHtml = useMemo(() => renderCuiTree(tree), [tree]);

  const toastTimer = useRef<number | null>(null);
  const say = useCallback((msg: string): void => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  }, []);

  /* 交互脚本不能写成内联 <script>：
   * Tauri 会把自带初始化脚本的 sha256 塞进 CSP 的 script-src，而按 CSP 规范，
   * 一旦存在 hash/nonce，'unsafe-inline' 就整条失效 —— srcdoc 里的内联脚本会被静默拦掉，
   * 预览就成了一动不动的死图（连 blob: 当 src 也可能被 srcdoc 的继承策略拦下）。
   * 最稳的一条路：在父窗口里用 Function 求值，把 iframe 的 document/window 传进去，
   * 模板脚本是内建的、可信的，不走 eval 的只是 .cui 的行为（那部分本来就是纯 DOM 操作）。 */
  const srcDoc = useMemo(() => {
    const body = treeHtml;
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>${TOKEN_CSS}</style>
<style>${BASE_CSS}</style>
<style id="cui-style"></style>
</head><body>${body}</body></html>`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, treeHtml]);

  const apply = useCallback((): void => {
    const d = frameRef.current?.contentDocument;
    if (!d) return;
    const style = d.getElementById('cui-style');
    if (style) style.textContent = result.css;
    /* text / src / hint 已经在 renderCuiTree 里写进 HTML 了。
       以前这里再按 6001 条选择器逐条 querySelectorAll，等于 O(n²)：
       6000 个元件的大工程光这一步就要好几秒，预览像卡死。 */
  }, [result]);

  useEffect(() => {
    if (ready) apply();
  }, [ready, apply]);

  /* ── 互动：统一走 runtime.ts（act 动作、go 切页、图标注入都只有一份） ── */
  const logicRef = useRef<Record<string, string>>({});
  logicRef.current = preview?.logic ?? {};

  const highlight = useCallback((el: HTMLElement | null): void => {
    if (hlRef.current) {
      hlRef.current.style.outline = '';
      hlRef.current.style.outlineOffset = '';
    }
    hlRef.current = el;
    if (el) {
      el.style.outline = '2px solid #0f9d58';
      el.style.outlineOffset = '2px';
    }
  }, []);

  /* 预览里的点击还有第二件事：选中元素给检查器用 */
  const onDocClick = useCallback((ev: Event): void => {
    const t = ev.target as Element | null;
    if (!t) return;
    const boxed = (t.closest('[data-t]') ?? t) as HTMLElement;
    const next: CuiPick = {
      tag: boxed.getAttribute('data-t') ?? '',
      cls: typeof boxed.className === 'string' ? boxed.className : '',
      id: boxed.id ?? ''
    };
    highlight(boxed);
    setPick(next);
  }, [highlight]);

  /* 注入界面宿主：page.* 从这一刻起有界面可操作（预览的 document） */
  const injectBridge = useCallback((): void => {
    const d = docRef.current;
    if (!d) return;
    setPageBridge(createPageBridge(d, say));
  }, [say]);

  /* 行为表变了就重挂运行时：只换监听器，不重建 iframe（预览里的输入不丢） */
  const detachRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const d = docRef.current;
    if (!ready || !d) return;
    detachRef.current?.();
    detachRef.current = attachCuiRuntime(d, result.behaviors, {
      say,
      call: (fn, hit) => {
        /* Copper 函数：把被点元素的选择器传进去（#id 优先） */
        const main = Object.keys(logicRef.current).find((k) => k.replace(/\\/g, '/') === 'app/main.co')
          ?? Object.keys(logicRef.current)[0];
        if (!main) {
          say('act call ' + fn + '：这个工程还没有前端逻辑文件（app/main.co）');
          return;
        }
        callCopperFn(logicRef.current, main.replace(/\\/g, '/'), fn, selectorOfHit(hit), (m) => say('⚠ ' + m));
      }
    });
    return () => {
      detachRef.current?.();
      detachRef.current = null;
    };
  }, [ready, result, say]);

  const attach = useCallback((): void => {
    const d = frameRef.current?.contentDocument;
    if (!d) return;
    docRef.current = d;
    d.addEventListener('click', onDocClick, true);
    apply();
    injectBridge();
  }, [onDocClick, apply, injectBridge]);

  useEffect(() => { setReady(false); setPick(null); }, [frameKey]);

  const matched = useMemo(
    () => (pick ? findRuleForPick(doc, pick) : null),
    [doc, pick]
  );

  const commit = useCallback((prop: string, raw: string): void => {
    const value = raw.trim();
    if (!pick || !value || !onPatch) return;
    onPatch(pick, prop, value);
    say(`${pickLabel(pick)}：${prop} ${value}`);
  }, [pick, onPatch, say]);

  const errors = result.diags.filter((d) => d.level === 'error');

  return (
    <div className="cui-pane">
      <div className="cui-pane-head">
        <span className="cui-pane-title">Copper UI</span>
        <span className="cui-pane-sub">.cui</span>
        <span className="cui-bar-gap" />
        <span className="cui-stat">
          {result.ruleCount} 条规则 · {result.declCount} 条属性
          {preview?.logic && Object.keys(preview.logic).length > 0 ? ' · 可交互' : ''}
        </span>
        {errors.length > 0 && <span className="cui-badge err">{errors.length} 个错误</span>}
        {result.diags.length > errors.length && (
          <span className="cui-badge warn">{result.diags.length - errors.length} 个提示</span>
        )}
      </div>

      <iframe
        ref={frameRef}
        key={frameKey ?? 'default'}
        className="cui-pane-frame"
        title="Copper UI 预览"
        srcDoc={srcDoc}
        sandbox="allow-same-origin allow-scripts"
        onLoad={() => { setReady(true); attach(); }}
      />

      {toast && <div className="cui-toast">{toast}</div>}

      <div className="cui-inspect">
        {pick ? (
          <>
            <div className="cui-inspect-head">
              <span className="cui-pick-sel">{pickLabel(pick)}</span>
              {matched
                ? <span className="cui-pick-line">第 {matched.span.line} 行</span>
                : <span className="cui-pick-line">还没有对应规则</span>}
              <span className="cui-bar-gap" />
              <button className="cui-mini" onClick={() => { highlight(null); setPick(null); }}>取消选中</button>
            </div>
            <div className="cui-inspect-fields">
              {INSPECT_PROPS.map((f) => {
                const cur = matched?.decls.find((d) => d.prop === f.prop);
                return (
                  <label key={f.prop} className="cui-field">
                    <span>{f.label}</span>
                    <input
                      key={`${f.prop}:${matched?.span.line ?? 0}:${valueText(cur?.values[0])}`}
                      defaultValue={valueText(cur?.values[0])}
                      placeholder={f.hint}
                      onKeyDown={(e) => { if (e.key === 'Enter') commit(f.prop, e.currentTarget.value); }}
                      onBlur={(e) => commit(f.prop, e.currentTarget.value)}
                    />
                  </label>
                );
              })}
            </div>
          </>
        ) : (
          <span className="cui-hint">点一下左边预览里的元素 → 下面直接改属性，代码自己写回去</span>
        )}
      </div>

      <div className="cui-pane-diags">
        {result.diags.length === 0
          ? <span className="cui-ok">语法没问题</span>
          : result.diags.map((d, i) => (
            <div key={i} className={d.level === 'error' ? 'cui-diag err' : 'cui-diag warn'}>
              第 {d.line} 行：{d.msg}
            </div>
          ))}
        <span className="cui-bar-gap" />
        {/* CUI 是 Studio 自带的；Copper 归环境。这里只报"接到哪一版"，不假装有内置编译。 */}
        <span className={env?.found ? 'cui-ok' : 'cui-diag warn'} title={env?.home || ''}>
          {env ? (env.found ? `Copper 环境 · ${env.compiler_name || 'colang'} v${env.compiler_version || env.version}` : 'Copper 环境未安装') : 'Copper 环境检查中…'}
        </span>
      </div>
    </div>
  );
}
