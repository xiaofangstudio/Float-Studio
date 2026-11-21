/* Monaco 的 .cui 语言定义：高亮、补全、悬停文档。
 *
 * 全部词汇从 props.ts 取，不在两个地方各写一遍——
 * 属性表改一次，编辑器里的颜色和提示跟着变。
 *
 * 补全是上下文感知的（这是 .cui 只出界面词、.co 只出 Copper 词的关键）：
 *   - 元件名位置：只出元件 + all，绝不混进属性和 Copper 代码；
 *   - 属性名没敲完：只出属性；
 *   - 值的位置：按属性类型给关键字 / 令牌；
 *   - when 后面：状态 + 事件；act 后面：七种动作；
 *   - 属性行：这个元件最相关的属性排前面。
 */

import * as monaco from 'monaco-editor';
import {
  ALL_ELEMENT_WORDS, ELEMENTS, EVENTS, PROPS, STATES, TOKENS,
  TOKEN_COLORS, elementName, matchProp
} from '@fangui/cui/props';
import { ICON_NAMES } from '@fangui/cui/icons';
import { UTILITIES, VARIANTS_OF } from '@fangui/cui/components';

export const CUI_LANG = 'cui';

/** act 后面的七种动作，和 parser 的 ACTION_KINDS 对应 */
const ACTS = [
  { name: 'add', detail: 'add 类名', desc: '给目标元素加一个类，样式立刻生效' },
  { name: 'remove', detail: 'remove 类名', desc: '把目标元素上的某个类去掉' },
  { name: 'toggle', detail: 'toggle 类名', desc: '有就删、没有就加，点击切换最常用' },
  { name: 'text', detail: 'text 选择器 "文字"', desc: '把目标元素的文字换掉' },
  { name: 'say', detail: 'say "提示"', desc: '在预览里弹一句提示' },
  { name: 'go', detail: 'go 目标', desc: '跳到另一个界面' },
  { name: 'call', detail: 'call 函数名', desc: '调用 app/*.co 里的 Copper 函数（传入被点元素的选择器）' }
] as const;

/** 每个元件最常用到的属性：补全时排前面 */
const RELEVANT_PROPS: Record<string, string[]> = {
  input: ['hint', 'type', 'width', 'background', 'border', 'radius', 'padding', 'size', 'color'],
  textarea: ['hint', 'width', 'height', 'background', 'border', 'radius', 'padding', 'size', 'color'],
  image: ['source', 'fit', 'width', 'height', 'radius', 'opacity'],
  checkbox: ['type', 'width', 'height', 'background'],
  radio: ['width', 'height'],
  slider: ['width', 'grow'],
  progress: ['width', 'height', 'grow'],
  text: ['text', 'size', 'weight', 'color', 'text align', 'lines', 'ellipsis'],
  button: ['text', 'background', 'color', 'radius', 'padding', 'size', 'weight', 'transition'],
  window: ['background', 'layout', 'padding', 'gap'],
  row: ['layout', 'gap', 'align', 'justify', 'padding'],
  column: ['layout', 'gap', 'align', 'justify', 'padding'],
  list: ['layout', 'gap', 'padding', 'grow'],
  scroll: ['overflow', 'grow', 'height'],
  box: ['background', 'radius', 'border', 'padding', 'shadow', 'layout', 'gap'],
  item: ['layout', 'align', 'gap', 'padding', 'background', 'radius'],
  spacer: ['grow']
};

/** 值位置的关键字候选：按属性名给。颜色类不在这里，走主题令牌。 */
const VALUE_WORDS: Record<string, string[]> = {
  width: ['fill', 'fit'],
  height: ['fill', 'fit'],
  'min width': ['fill'], 'max width': ['fill'], 'min height': ['fill'], 'max height': ['fill'],
  layout: ['flow', 'row', 'column', 'stack', 'grid'],
  direction: ['row', 'column'],
  justify: ['start', 'end', 'center', 'between', 'around', 'evenly'],
  align: ['start', 'end', 'center', 'stretch', 'baseline'],
  'self align': ['start', 'end', 'center', 'stretch'],
  'align content': ['start', 'end', 'center', 'stretch', 'between', 'around', 'evenly'],
  cursor: ['pointer', 'text', 'move', 'not', 'grab', 'wait', 'cross'],
  'text transform': ['upper', 'lower', 'capital', 'none'],
  'white space': ['wrap', 'nowrap', 'normal', 'pre'],
  order: [], columns: ['repeat(2, 1fr)', 'repeat(3, 1fr)'], rows: ['auto 1fr'],
  aspect: ['16 9', '4 3', '1 1'],
  filter: ['blur(4px)', 'brightness(1.2)', 'saturate(1.2)'],
  backdrop: ['blur(8px)', 'brightness(1.1)'],
  'border style': ['solid', 'dashed', 'dotted', 'double', 'none'],
  float: ['left', 'right', 'none'],
  clear: ['left', 'right', 'both', 'none'],
  decoration: ['underline', 'line', 'overline', 'none'],
  'font style': ['normal', 'italic', 'oblique'],
  'vertical align': ['top', 'middle', 'bottom', 'baseline'],
  'list style': ['none', 'disc', 'circle', 'square', 'decimal'],
  break: ['normal', 'break', 'keep'],
  'overflow wrap': ['normal', 'anywhere', 'break'],
  select: ['none', 'text', 'all'],
  writing: ['horizontal', 'vertical'],
  'background size': ['cover', 'contain', '100% auto'],
  'background position': ['center', 'left top', 'right bottom'],
  'background repeat': ['repeat', 'none', 'x', 'y'],
  'background clip': ['border', 'padding', 'content', 'text'],
  blend: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'],
  visibility: ['show', 'hide'],
  pointer: ['auto', 'none'],
  'scroll behavior': ['auto', 'smooth'],
  backface: ['show', 'hide'],
  'fill mode': ['none', 'forwards', 'backwards', 'both'],
  'play state': ['running', 'paused'],
  resize: ['none', 'both', 'horizontal', 'vertical'],
  touch: ['auto', 'none', 'pan'],
  'justify items': ['start', 'end', 'center', 'stretch'],
  'justify self': ['start', 'end', 'center', 'stretch'],
  'auto flow': ['row', 'column', 'dense'],
  'background': ['gradient(90, accent, primary)', 'gradient(180, tint, canvas)', 'radial(accent, tint)'],
  wrap: ['nowrap', 'wrap'],
  overflow: ['show', 'hide', 'scroll', 'auto'],
  position: ['flow', 'absolute', 'fixed', 'sticky'],
  weight: ['light', 'regular', 'medium', 'semibold', 'bold'],
  'text align': ['start', 'center', 'end'],
  boxing: ['border', 'content'],
  fit: ['cover', 'contain', 'fill'],
  ellipsis: ['clip', 'ellipsis'],
  ease: ['linear', 'in', 'out', 'inout', 'spring'],
  transition: ['background', 'color', 'opacity', 'radius', 'shadow', 'border', 'padding'],
  type: ['text', 'password', 'number'],
  border: ['line', 'edge', 'hairline', 'accent']
};

/** 属性首词（多词属性取第一个词），去掉和元件同名的 text */
const ATTR_WORDS = Array.from(
  new Set(PROPS.map((p) => p.name.split(' ')[0]).filter((w) => !ALL_ELEMENT_WORDS.has(w)))
);

/** 往上扫，找到当前这条规则的选择器行，取它的元件名（供"相关属性排前"用） */
function ruleElementAbove(model: monaco.editor.ITextModel, line: number): string {
  const curIndent = (model.getLineContent(line).match(/^\s*/) ?? [''])[0].length;
  for (let i = line - 1; i >= 1; i--) {
    const text = model.getLineContent(i);
    if (!text.trim() || text.trim().startsWith('/*')) continue;
    const ind = (text.match(/^\s*/) ?? [''])[0].length;
    if (ind >= curIndent) continue;
    const first = text.trim().split(/\s+/)[0] ?? '';
    if (ALL_ELEMENT_WORDS.has(first)) return elementName(first);
    return '';
  }
  return '';
}

let registered = false;

export function registerCuiLanguage(): void {
  if (registered) return;
  if (monaco.languages.getLanguages().some((l) => l.id === CUI_LANG)) {
    registered = true;
    return;
  }
  registered = true;

  monaco.languages.register({ id: CUI_LANG, extensions: ['.cui'], aliases: ['Copper UI', 'cui'] });

  monaco.languages.setLanguageConfiguration(CUI_LANG, {
    comments: { lineComment: '/*' },
    brackets: [['(', ')'], ['[', ']']],
    autoClosingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '(', close: ')' },
      { open: '[', close: ']' }
    ],
    surroundingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '(', close: ')' }
    ]
  });

  monaco.languages.setMonarchTokensProvider(CUI_LANG, {
    defaultToken: '',
    tokenPostfix: '.cui',
    keywords: ['when', 'act', 'all', 'on', 'child', 'next', 'sibling', ...ELEMENTS.map((e) => e.name)],
    states: STATES.map((s) => s.name),
    /* text 既是属性名又是元件名，交给 keywords 处理，别在这抢 */
    actions: ACTS.map((a) => a.name).filter((n) => n !== 'text'),
    operators: ['#', ',', '(', ')', '*', '>'],
    tokenizer: {
      root: [
        /* 注释：/* 到行尾 */
        [/\/\*.*$/, 'comment'],
        /* 字符串 */
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'string'],
        /* 十六进制颜色 */
        [/#[0-9a-fA-F]{3,8}\b/, 'number.hex'],
        /* 数字 + 单位 */
        [/-?\d+(\.\d+)?(px|%|em|rem|ms|s|deg)?/, 'number'],
        /* 属性首词 */
        [new RegExp(`\\b(${ATTR_WORDS.join('|')})\\b`), 'attribute.name'],
        /* 函数名 */
        [/[a-zA-Z_]\w*(?=\s*\()/, 'type.identifier'],
        /* 元件 / when / 状态 */
        [/[a-zA-Z_][\w]*/, {
          cases: {
            '@keywords': 'keyword',
            '@states': 'keyword.state',
            '@actions': 'keyword.action',
            '@default': 'identifier'
          }
        }],
        [/[{}]/, '@brackets'],
        [/[;,:]/, 'delimiter']
      ]
    }
  });

  /* ── 补全 ── */
  monaco.languages.registerCompletionItemProvider(CUI_LANG, {
    triggerCharacters: [' '],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, position.column - 1);
      const trimmed = before.trim();
      const words = trimmed.split(/\s+/).filter(Boolean);
      const firstWord = words[0] ?? '';
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);

      type Item = monaco.languages.CompletionItem;
      const suggestions: Item[] = [];

      /* `when ` 后面：只出状态和事件，别的什么都不出 */
      if (/\bwhen\s+[a-z]*$/.test(before) || (words.length === 1 && firstWord === 'when')) {
        for (const s of STATES) {
          suggestions.push({
            label: s.name,
            kind: monaco.languages.CompletionItemKind.EnumMember,
            detail: s.css,
            documentation: s.desc,
            insertText: s.name,
            range
          });
        }
        for (const e of EVENTS) {
          suggestions.push({
            label: e.name,
            kind: monaco.languages.CompletionItemKind.Event,
            detail: '事件 · 下面写 act',
            documentation: `${e.desc}触发，下面缩进写 act 动作`,
            insertText: e.name,
            range
          });
        }
        return { suggestions };
      }

      /* `act ` 后面：只出七种动作 */
      if (/^\s*act\s+[a-z]*$/.test(before) || (words.length === 1 && firstWord === 'act')) {
        for (const a of ACTS) {
          suggestions.push({
            label: a.name,
            kind: monaco.languages.CompletionItemKind.Method,
            detail: a.detail,
            documentation: a.desc,
            insertText: a.name + ' ',
            range
          });
        }
        return { suggestions };
      }

      /* 值的位置：整行是 recognized 属性 → 按属性类型给关键字 / 令牌 */
      const propHit = words.length > 0 && !ALL_ELEMENT_WORDS.has(firstWord) && firstWord !== 'all'
        ? matchProp(words)
        : null;
      if (propHit) {
        for (const v of VALUE_WORDS[propHit.prop.name] ?? []) {
          suggestions.push({
            label: v,
            kind: monaco.languages.CompletionItemKind.Value,
            detail: '关键字',
            documentation: `${propHit.prop.name} 的一个取值`,
            insertText: v,
            range
          });
        }
        for (const t of TOKENS) {
          suggestions.push({
            label: t,
            kind: monaco.languages.CompletionItemKind.Color,
            detail: '主题令牌',
            documentation: `${TOKEN_COLORS[t] ?? ''} · 编译成 var(--${t})`,
            insertText: t,
            range
          });
        }
        return { suggestions };
      }

      /* 元件名位置：行首（或 all 后面）只出元件 */
      if (trimmed === '' || firstWord === 'all') {
        for (const e of ELEMENTS) {
          suggestions.push({
            label: e.name,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: '元件',
            documentation: e.desc,
            insertText: e.name,
            range
          });
        }
        suggestions.push({
          label: 'all',
          kind: monaco.languages.CompletionItemKind.Keyword,
          detail: '只写样式，不建元件',
          documentation: '描述"已经在的元素"长什么样，比如 all button primary when hover',
          insertText: 'all ',
          range
        });
        return { suggestions };
      }

      /* icon 元件里直接出图标名：text "名字" 或 name 名字 都能用 */
      const ruleEl = ruleElementAbove(model, position.lineNumber);
      if (ruleEl === 'icon') {
        for (const n of ICON_NAMES) {
          suggestions.push({
            label: n,
            kind: monaco.languages.CompletionItemKind.Value,
            detail: '内置图标',
            documentation: '写成 text "' + n + '" 或 name ' + n + '，运行时注入内联 SVG，颜色跟随 color 属性',
            insertText: n,
            sortText: '0' + n,
            range
          });
        }
      }

      /* 类名位置：这一行已经写了元件名 → 出这个元件的变体 / 尺寸，再补通用工具类 */
      const lineEl = ALL_ELEMENT_WORDS.has(firstWord) ? elementName(firstWord) : ruleEl;
      if (lineEl && trimmed.includes(' ') && !propHit) {
        for (const v of VARIANTS_OF[lineEl] ?? []) {
          suggestions.push({
            label: v,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: '变体 / 尺寸',
            documentation: `${lineEl} 的类名，直接写在元件那一行`,
            insertText: v,
            sortText: '0' + v,
            range
          });
        }
        for (const u of UTILITIES) {
          suggestions.push({
            label: u,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: '工具类',
            documentation: '布局 / 排版修饰，任意元件都能用',
            insertText: u,
            sortText: '1' + u,
            range
          });
        }
      }

      /* 属性行：属性名还没敲全（matchProp 没认出来）→ 出属性；
         这个元件最相关的排最前，再补 when / act / 子元件 */
      const relevant = new Set(RELEVANT_PROPS[ruleEl] ?? []);
      const sorted = [...PROPS].sort((a, b) => {
        const ra = relevant.has(a.name) ? 0 : 1;
        const rb = relevant.has(b.name) ? 0 : 1;
        return ra - rb;
      });
      for (const p of sorted) {
        suggestions.push({
          label: p.name,
          kind: monaco.languages.CompletionItemKind.Property,
          detail: p.css ? `→ ${p.css}` : '文本内容',
          documentation: p.desc,
          insertText: p.name + ' ',
          range
        });
      }
      for (const s of STATES) {
        suggestions.push({
          label: `when ${s.name}`,
          kind: monaco.languages.CompletionItemKind.Keyword,
          detail: s.css,
          documentation: s.desc,
          insertText: `when ${s.name}`,
          range
        });
      }
      for (const e of EVENTS) {
        suggestions.push({
          label: `when ${e.name}`,
          kind: monaco.languages.CompletionItemKind.Event,
          detail: '事件 · 下面写 act',
          documentation: `${e.desc}触发，下面缩进写 act 动作`,
          insertText: `when ${e.name}\n    act `,
          range
        });
      }
      suggestions.push({
        label: 'act',
        kind: monaco.languages.CompletionItemKind.Keyword,
        detail: '界面里写行为（配 when 事件）',
        documentation: 'act add / remove / toggle / text / say / go / call',
        insertText: 'act ',
        range
      });
      /* 顺手补元件：写完一条规则的属性，可能接着写子元件 */
      for (const e of ELEMENTS) {
        suggestions.push({
          label: e.name,
          kind: monaco.languages.CompletionItemKind.Class,
          detail: '元件',
          documentation: e.desc,
          insertText: e.name,
          range
        });
      }
      return { suggestions };
    }
  });

  /* ── 颜色：十六进制色值变成色块，点开就是取色器（色相 / 饱和度 / 明度） ── */
  type Rgba = { red: number; green: number; blue: number; alpha: number };
  const parseHex = (hex: string): Rgba | null => {
    let h = hex.replace(/^#/, '');
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { red: r, green: g, blue: b, alpha: a };
  };

  const toHex = (c: Rgba): string => {
    const h = (n: number): string => Math.round(n * 255).toString(16).padStart(2, '0');
    return `#${h(c.red)}${h(c.green)}${h(c.blue)}${c.alpha < 1 ? h(c.alpha) : ''}`;
  };

  monaco.languages.registerColorProvider(CUI_LANG, {
    provideDocumentColors(model) {
      const out: monaco.languages.IColorInformation[] = [];
      /* 模型可能已经被 closeDoc / 切文件销毁。Monaco 在被销毁的 model 上取
         位置会直接抛 "Model is disposed!"，把整个界面打崩——先检查再干活。 */
      if (model.isDisposed()) return out;
      const text = model.getValue();
      /* 超大 .cui 保护：装饰器上限 2000 个，超过就不再扫。
         几万个色块本来也看不清，继续扫只会拖慢每一次输入。 */
      const MAX = 2000;
      const re = /#[0-9a-fA-F]{3,8}\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (out.length >= MAX || model.isDisposed()) break;
        const color = parseHex(m[0]);
        if (!color) continue;
        const start = model.getPositionAt(m.index);
        const end = model.getPositionAt(m.index + m[0].length);
        out.push({ color, range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column) });
      }
      return out;
    },
    provideColorPresentations(_model, info) {
      return [{ label: toHex(info.color) }];
    }
  });

  /* ── 悬停文档 ── */
  monaco.languages.registerHoverProvider(CUI_LANG, {
    provideHover(model, position) {
      if (model.isDisposed()) return null;
      /* 十六进制色值：悬停给色值、RGB 与操作提示；色块点击出取色器 */
      const lineText = model.getLineContent(position.lineNumber);
      const hexRe = /#([0-9a-fA-F]{3,8})\b/g;
      let hm: RegExpExecArray | null;
      while ((hm = hexRe.exec(lineText)) !== null) {
        const from = hm.index + 1;
        const to = hm.index + hm[0].length + 1;
        if (position.column < from || position.column > to) continue;
        const c = parseHex(hm[0]);
        if (!c) break;
        const rgb = [Math.round(c.red * 255), Math.round(c.green * 255), Math.round(c.blue * 255)].join(', ');
        return {
          contents: [
            { value: `**颜色** \`${hm[0]}\`` },
            { value: `rgb(${rgb})${c.alpha < 1 ? ` · 透明度 ${Math.round(c.alpha * 100)}%` : ''}` },
            { value: '点左侧色块可打开取色器：色相、饱和度、明度都能直接拖。' }
          ]
        };
      }

      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const w = word.word;

      const prop = PROPS.find((p) => p.name === w) ?? PROPS.find((p) => p.name.startsWith(w + ' '));
      if (prop) {
        return {
          contents: [
            { value: `**${prop.name}**${prop.css ? `  →  \`${prop.css}\`` : ''}` },
            { value: prop.desc }
          ]
        };
      }
      const el = ELEMENTS.find((e) => e.name === w);
      if (el) return { contents: [{ value: `**${el.name}**（元件）` }, { value: el.desc }] };
      const st = STATES.find((s) => s.name === w);
      if (st) return { contents: [{ value: `**when ${st.name}**  →  \`${st.css}\`` }, { value: st.desc }] };
      const ev = EVENTS.find((e) => e.name === w);
      if (ev) return { contents: [{ value: `**when ${ev.name}**（事件）` }, { value: `${ev.desc}；下面缩进写 act 动作` }] };
      if (w === 'all') {
        return { contents: [{ value: '**all**：只写样式，不建元件' }, { value: '描述"已经在的元素"长什么样。' }] };
      }
      if (w === 'when') {
        return { contents: [{ value: '**when**：状态与事件' }, { value: '后面写 hover / focus 这类状态，或 click / enter 这类事件；事件下面缩进写 act。' }] };
      }
      if (w === 'act') {
        return {
          contents: [
            { value: '**act**：界面里写行为' },
            { value: '写在 `when click` 这类事件规则下面，共 7 种动作：add / remove / toggle / text / say / go / call。' }
          ]
        };
      }
      const act = ACTS.find((a) => a.name === w);
      if (act) return { contents: [{ value: `**act ${act.name}**` }, { value: act.desc }] };
      const tk = TOKEN_COLORS[w];
      if (tk) return { contents: [{ value: `**${w}**（主题令牌）` }, { value: `${tk} · 编译成 \`var(--${w})\`` }] };
      return null;
    }
  });
}

