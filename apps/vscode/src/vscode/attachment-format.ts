/**
 * attachment-format.ts — Phase 10 附着:纯函数(零 vscode 依赖,可单测)。
 *
 * 职责:
 * 1. 拖放解析:text/uri-list(Explorer 拖入的标准 MIME,纯 URI 行,非 JSON);
 * 2. 文本工具:fence 选择(防正文反引号冲突)、截断、二进制检测(NUL 字节);
 * 3. 发送上下文格式化:<editor-context> + <attachments> 纯文本块。
 *
 * 红线:model-visible ⟺ logged —— 本模块产出的 text 就是最终发给模型的完整前缀。
 */
import type { SelectionInfo } from '../agent/context.js';

// ---- 拖放解析 ----

/** text/uri-list 值 = 每行一个 URI(可能 `\r\n`),# 开头为注释;按行去重。 */
export function parseUriList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/** 从 URI 提取文件名(最后一段,decodeURIComponent 容错)。 */
export function nameFromUri(uriString: string): string {
  const m = uriString.match(/[^/\\]+$/);
  if (!m) return uriString;
  try {
    return decodeURIComponent(m[0]);
  } catch {
    return m[0];
  }
}

// ---- 文本工具 ----

/** 动态 fence:正文含 n 个连续反引号时用 n+1 个,避免闭合冲突。 */
export function makeFence(text: string): string {
  const runs = text.match(/`{3,}/g) ?? [];
  const maxRun = runs.reduce((max, value) => Math.max(max, value.length), 2);
  return '`'.repeat(maxRun + 1);
}

export interface TruncateResult {
  text: string;
  truncated: boolean;
}

export function truncateText(text: string, limit: number): TruncateResult {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

/** 二进制检测:前 4096 字节含 NUL 即视为二进制(不发送正文)。 */
export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

/** 人类可读大小(展示用)。 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return String(bytes);
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---- 选区工具 ----

/** 0-based Selection → 1-based SelectionInfo(含文本);空选区不产生。 */
export function toSelectionInfo(
  startLine0: number,
  startCol0: number,
  endLine0: number,
  endCol0: number,
  text: string,
): SelectionInfo {
  return {
    startLine: startLine0 + 1,
    startCol: startCol0 + 1,
    endLine: endLine0 + 1,
    endCol: endCol0 + 1,
    text,
  };
}

/** 选区是否覆盖整个文档(与 full-file 去重)。lineCount/lastLineLength 为 0-based 事实。 */
export function isWholeFileSelection(
  sel: SelectionInfo,
  lineCount: number,
  lastLineLength: number,
): boolean {
  const wholeStart = sel.startLine === 1 && sel.startCol === 1;
  const wholeEnd = sel.endLine === lineCount && sel.endCol === lastLineLength + 1;
  return wholeStart && wholeEnd;
}

// ---- 发送上下文格式化 ----

export interface AttachmentBodyResult {
  kind: 'content' | 'too-large' | 'binary' | 'unreadable';
  text?: string;
  truncated?: boolean;
  size?: number;
  message?: string;
}

export interface SendAttachmentInput {
  id: string;
  name: string;
  displayPath: string;
  outsideWorkspace: boolean;
  languageId?: string;
  body: AttachmentBodyResult;
}

export interface SendContextInput {
  /** 活动编辑器元数据(path/languageId/isDirty/isUntitled;不含正文) */
  activeFile?: { path: string; languageId: string; isDirty: boolean; isUntitled: boolean };
  /** 附着活动文件开启时:完整文件文本(发送瞬间快照,含未保存改动) */
  fullFileText?: string;
  /** 附着活动文件开关 */
  attachActiveFile: boolean;
  /** 附着活动选区开关 */
  attachSelection: boolean;
  /** 发送瞬间选区快照(1-based + 文本) */
  selections: readonly SelectionInfo[];
  /** 选区覆盖整个文件(与 full-file 去重) */
  selectionWholeFile: boolean;
  /** 活动文件诊断(沿用现有注入) */
  diagnostics: readonly { file: string; line: number; severity: string; message: string }[];
  /** git 工作区变更摘要(沿用现有注入) */
  gitChanges: readonly { path: string; additions: number; deletions: number }[];
  /** 拖入附着文件(正文已由扩展侧读取) */
  attachments: readonly SendAttachmentInput[];
  /** 上限覆盖(默认:单文件 20k 字符,附件总 100k 字符) */
  caps?: { perFileChars?: number; totalChars?: number };
}

export interface SendContextResult {
  text: string;
  warnings: string[];
}

const DEFAULT_PER_FILE_CHARS = 20_000;
const DEFAULT_TOTAL_CHARS = 100_000;
const MAX_DIAGNOSTICS = 20;

/** 组装发送前缀:file/语言/诊断/git 元数据 + 可选 full-file/选区正文 + 附件块。
 * 返回空串表示无任何可注入内容(调用方直接发用户文本)。 */
export function formatSendContext(input: SendContextInput): SendContextResult {
  const perFileChars = input.caps?.perFileChars ?? DEFAULT_PER_FILE_CHARS;
  const totalChars = input.caps?.totalChars ?? DEFAULT_TOTAL_CHARS;
  const warnings: string[] = [];
  const blocks: string[] = [];

  // ---- <editor-context>:文件元数据(路径/语言/脏标记总是注入,正文才受开关控制) ----
  const editorLines: string[] = [];
  if (input.activeFile !== undefined) {
    const f = input.activeFile;
    editorLines.push(`<file>${f.path}</file>`);
    editorLines.push(`<language>${f.languageId}</language>`);
    if (f.isDirty) editorLines.push('<dirty>true</dirty>');
  }
  if (input.diagnostics.length > 0) {
    editorLines.push('diagnostics:');
    for (const d of input.diagnostics.slice(0, MAX_DIAGNOSTICS)) {
      editorLines.push(`- [${d.severity}] ${d.file}:${d.line}: ${d.message}`);
    }
    if (input.diagnostics.length > MAX_DIAGNOSTICS) {
      editorLines.push(`- …(另有 ${input.diagnostics.length - MAX_DIAGNOSTICS} 条)`);
    }
  }
  if (input.gitChanges.length > 0) {
    editorLines.push('git working-tree changes:');
    for (const g of input.gitChanges) {
      editorLines.push(`- ${g.path} (+${g.additions}/-${g.deletions})`);
    }
  }
  // 附着活动选区:每个非空选区一个 <selection> 块(文本 20k 截断)
  if (input.attachSelection && input.selections.length > 0 && !input.selectionWholeFile) {
    input.selections.forEach((s, index) => {
      const { text, truncated } = truncateText(s.text, perFileChars);
      const fence = makeFence(text);
      const note = truncated
        ? `\n[truncated: selection exceeded ${perFileChars} characters]`
        : '';
      editorLines.push(`<selection index="${index + 1}" range="${s.startLine}:${s.startCol}-${s.endLine}:${s.endCol}">`);
      editorLines.push(`${fence}${text}\n${fence}${note}`);
      editorLines.push('</selection>');
    });
  }
  // 附着活动文件:完整文件内容(发送瞬间快照,含未保存改动;20k 截断)
  if (input.attachActiveFile && input.activeFile !== undefined && input.fullFileText !== undefined) {
    const { text, truncated } = truncateText(input.fullFileText, perFileChars);
    const fence = makeFence(text);
    const note = truncated
      ? `\n[truncated: file exceeded ${perFileChars} characters]`
      : '';
    editorLines.push('<full-file>');
    editorLines.push(`${fence}${text}\n${fence}${note}`);
    editorLines.push('</full-file>');
  }
  if (editorLines.length > 0) {
    blocks.push(`<editor-context>\n${editorLines.join('\n')}\n</editor-context>`);
  }

  // ---- <attachments>:拖入文件(内容/过大/二进制/不可读;总量 100k 上限) ----
  if (input.attachments.length > 0) {
    const attLines: string[] = [];
    let budget = totalChars;
    let truncatedAny = false;
    for (const a of input.attachments) {
      const meta = `name="${a.name}" path="${a.displayPath}"`
        + (a.languageId !== undefined ? ` language="${a.languageId}"` : '')
        + (a.outsideWorkspace ? ' outside-workspace="true"' : '');
      if (a.body.kind === 'content') {
        const { text, truncated } = truncateText(a.body.text ?? '', perFileChars);
        const fence = makeFence(text);
        const note = truncated
          ? `\n[truncated: file exceeded ${perFileChars} characters]`
          : '';
        const block = `\n${fence}${text}\n${fence}${note}\n`;
        const estimated = block.length + meta.length + 64;
        if (budget - estimated < 0) {
          truncatedAny = true;
          continue;
        }
        budget -= estimated;
        attLines.push(`<file ${meta}>${block}</file>`);
      } else if (a.body.kind === 'too-large') {
        attLines.push(`<file ${meta} note="too-large: ${formatSize(a.body.size ?? 0)}, content omitted">\n</file>`);
        warnings.push(`附件过大已省略正文:${a.name}`);
      } else if (a.body.kind === 'binary') {
        attLines.push(`<file ${meta} note="binary file, content omitted">\n</file>`);
        warnings.push(`二进制文件已省略正文:${a.name}`);
      } else {
        attLines.push(`<file ${meta} note="unreadable: ${a.body.message ?? ''}">\n</file>`);
        warnings.push(`附件读取失败:${a.name}(${a.body.message ?? ''})`);
      }
    }
    if (truncatedAny) {
      attLines.push('<note>some attachments omitted: total content exceeded the budget</note>');
      warnings.push('部分附件正文因总量上限被省略');
    }
    blocks.push(`<attachments>\n${attLines.join('\n')}\n</attachments>`);
  }

  return { text: blocks.join('\n\n'), warnings };
}

/** 最终消息 = 上下文前缀 + 用户文本(前缀空则原样返回用户文本)。 */
export function composeFinalMessage(userText: string, contextText: string): string {
  return contextText === '' ? userText : `${contextText}\n\n${userText}`;
}

