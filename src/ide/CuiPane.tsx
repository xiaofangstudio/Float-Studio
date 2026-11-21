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

/** 预览用的样例数据：CUI 里的 {{key}} 在这里有值才像真界面，
 *  没有值就留白，绝不把花括号原样画到用户眼前。 */
export type CuiPreviewData = {
  values?: Record<string, string>;
  /** 图片路径覆盖：CUI 里写 /brand/x.png，这里给出内嵌 data URI，离线也能看 */
  assets?: Record<string, string>;
  /** 软件形状：横屏 16:9 / 竖屏 9:16 */
  orientation?: 'landscape' | 'portrait';
};

export type CuiPaneProps = {
  /** 当前 .cui 缓冲区里的文本 */
  code: string;
  /** 前端 Copper 逻辑（app/*.co，工程相对路径 → 源码）；act call 调这里的函数 */
  preview?: { logic?: Record<string, string> };
  /** 预览样例数据（preview.json / .float/preview.json） */
  data?: CuiPreviewData;
  /** 预览结构变了（换文件）就重建 iframe */
  frameKey?: string;
  /** 检查器改了属性：把这一行写回源码 */
  onPatch?: (pick: CuiPick, prop: string, value: string) => void;
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 把 {{key}} 在 CUI 源码里先填掉：字符串值压成单行、引号换成全角，
 *  跟 FangBox 的 bridge.fill 一个规矩，避免把界面语法写坏。 */
function fillCui(src: string, data?: CuiPreviewData): string {
  const values = data?.values ?? {};
  const val = (s: string): string => s.replace(/"/g, '”').replace(/\r?\n/g, ' ').trim();
  return src.replace(/\{\{([\w.]+)\}\}/g, (_m, key: string) => {
    const v = values[key];
    return v === undefined || v === null ? '' : val(String(v));
  });
}

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

export function CuiPane({ code, preview, data, frameKey, onPatch }: CuiPaneProps): React.ReactElement {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const docRef = useRef<Document | null>(null);
  const hlRef = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [pick, setPick] = useState<CuiPick | null>(null);
  const [toast, setToast] = useState('');
  const [env, setEnv] = useState<CopperEnvInfo | null>(null);
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>(
    data?.orientation === 'portrait' ? 'portrait' : 'landscape'
  );
  useEffect(() => {
    setOrientation(data?.orientation === 'portrait' ? 'portrait' : 'landscape');
  }, [data?.orientation]);

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
  const doc = useMemo(() => parseCui(fillCui(heavyCode, data)), [heavyCode, data]);
  const result = useMemo(() => compileDocument(doc), [doc]);

  /* 界面结构由 .cui 自己长出来：一条规则 = 一个元件。 */
  const tree = useMemo(() => buildCuiTree(doc), [doc]);
  const treeHtml = useMemo(() => renderCuiTree(tree), [tree]);

  /* 图片路径用 assets 里给的内嵌图替换；文字在 parse 前就填好了。 */
  const visibleHtml = useMemo(() => {
    const assets = data?.assets ?? {};
    return treeHtml.replace(/(src|href)="([^"]+)"/g, (m, attr: string, url: string) => {
      const v = assets[url];
      return v ? `${attr}="${escapeHtml(v)}"` : m;
    });
  }, [treeHtml, data]);

  /* 舞台按软件形状裁：横屏 16:9、竖屏 9:16。预览不再是随便拉伸的一块布。
   * 用 ResizeObserver 量可用区域，等比缩到最大不溢出的尺寸。 */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = (): void => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /* 按一个标准视口排版，再整体等比缩到画布里。
   * 直接把 iframe 拉成 400×250 会让界面按 400 宽重排，侧栏、顶栏全被挤坏；
   * 缩放保留原布局，看到的才是“真窗口缩小”，而不是“窗口被捏扁”。 */
  const designW = orientation === 'portrait' ? 720 : 1280;
  const designH = orientation === 'portrait' ? 1280 : 720;
  const scale = Math.max(0, Math.min((stage.w - 20) / designW, (stage.h - 20) / designH));
  const frameW = designW * scale;
  const frameH = designH * scale;

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
    const body = visibleHtml;
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>.is-hidden{display:none !important}</style>
<style>${TOKEN_CSS}</style>
<style>${BASE_CSS}</style>
<style id="cui-style"></style>
</head><body>${body}</body></html>`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);

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

  /* 只换预览里的 DOM，不重载 iframe。
   * 以前 treeHtml 一变，srcDoc 就变，iframe 整页重载：886KB 的大工程每改一个字
   * 左边都会先白一下再重新长出来。现在 iframe 只在切文件时重建，结构/文字变了
   * 就直接替换 body.innerHTML，样式再走 apply()，视觉上不掉帧。 */
  const syncBody = useCallback((): void => {
    const d = frameRef.current?.contentDocument;
    if (!d || !d.body) return;
    /* 先落样式再换 DOM：反过来会有一帧“新结构 + 旧空样式”的裸奔画面。 */
    apply();
    if (d.body.innerHTML !== visibleHtml) d.body.innerHTML = visibleHtml;
    apply();
  }, [visibleHtml, apply]);

  useEffect(() => {
    syncBody();
  }, [ready, syncBody]);

  /* 样例数据比 iframe 晚到是常态：数据到了再补一次，等 DOM 就绪后重试几拍。 */
  useEffect(() => {
    if (!data) return;
    let tries = 0;
    let timer = 0;
    const tick = (): void => {
      syncBody();
      if (tries++ < 8) timer = window.setTimeout(tick, 60);
    };
    tick();
    return () => { if (timer) window.clearTimeout(timer); };
  }, [data, syncBody]);

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
    /* iframe 一加载就按最新内容铺一遍：样例数据可能比 iframe 晚到，
       只等后面的 effect 会漏掉“先 load、后拿到数据”这一拍。 */
    apply();
    if (d.body.innerHTML !== visibleHtml) d.body.innerHTML = visibleHtml;
    apply();
    d.addEventListener('click', onDocClick, true);
    injectBridge();
  }, [onDocClick, apply, injectBridge, visibleHtml]);

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
        <div className="cui-orient" title="预览按软件形状等比显示">
          <button
            className={orientation === 'landscape' ? 'on' : ''}
            onClick={() => setOrientation('landscape')}
            title="横屏 16:9"
          >16:9</button>
          <button
            className={orientation === 'portrait' ? 'on' : ''}
            onClick={() => setOrientation('portrait')}
            title="竖屏 9:16"
          >9:16</button>
        </div>
        {errors.length > 0 && <span className="cui-badge err">{errors.length} 个错误</span>}
        {result.diags.length > errors.length && (
          <span className="cui-badge warn">{result.diags.length - errors.length} 个提示</span>
        )}
      </div>

      <div className="cui-stage" ref={stageRef}>
        <div
          className="cui-stage-box"
          style={frameW > 0 && frameH > 0 ? { width: frameW, height: frameH } : { opacity: 0 }}
        >
          <iframe
            ref={frameRef}
            key={frameKey ?? 'default'}
            className="cui-pane-frame"
            title="Copper UI 预览"
            style={{
              width: designW,
              height: designH,
              transform: `scale(${scale})`,
              transformOrigin: 'top left'
            }}
            srcDoc={srcDoc}
            sandbox="allow-same-origin allow-scripts"
            onLoad={() => { setReady(true); attach(); }}
          />
        </div>
      </div>

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
