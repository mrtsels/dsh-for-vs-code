/**
 * context-attachments.ts — Phase 10 附着管理器(extension host)。
 *
 * 职责:
 * - 持有附着状态:活动编辑器元数据 + 选区摘要 + 拖入文件引用(webview 只传 URI);
 * - 编辑器事件订阅(onDidChangeActiveTextEditor 即时 / onDidChangeTextEditorSelection 50ms
 *   防抖)刷新状态并推送 webview;
 * - 设置开关(deepseekHarness.context.attachActiveFile / attachSelection)读写;
 * - addUris:URI 校验 + stat + 目录拒绝 + 去重 + 数量上限(16);
 * - collectForSend:发送瞬间快照 —— 读活动编辑器(含未保存改动/untitled)+ 附件文件
 *   (大小 1 MiB 上限、二进制检测、20k 截断、总量 100k)→ formatSendContext 纯函数组装。
 *
 * 红线:webview 不直读文件系统;文件内容只在扩展侧读取;model-visible ⟺ logged。
 * 纯函数部分(parseUriList/fence/truncate/binary/toSelectionInfo/isWholeFileSelection/
 * formatSendContext)在 attachment-format.ts,可单测;本模块只做 vscode 薄胶水。
 */
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { AttachmentRef, AttachmentState, SelectionSummary } from '../webview/bridge.js';
import type { DiagnosticItem, SelectionInfo } from '../agent/context.js';
import {
  formatSendContext,
  looksBinary,
  nameFromUri,
  toSelectionInfo,
  isWholeFileSelection,
} from './attachment-format.js';

/** 单次附着文件数上限 */
const MAX_ATTACHMENTS = 16;
/** 单文件读取上限(超过不读正文,只发 metadata + 提示) */
const MAX_ATTACHMENT_BYTES = 1024 * 1024;
/** 单文件正文 20k 字符截断 */
const PER_FILE_CHARS = 20_000;
/** 附件正文总量 100k 字符上限 */
const TOTAL_CHARS = 100_000;

/** collectForSend 入参:诊断/git 由调用方(askWithContext)收集后传入,保持本模块零 IO 之外的职责 */
export interface CollectSendOptions {
  diagnostics: DiagnosticItem[];
  gitChanges: readonly { path: string; additions: number; deletions: number }[];
}

/** 附着错误(webview toast 展示) */
export interface AttachmentError {
  code: 'invalid-uri' | 'directory' | 'unreadable' | 'too-large' | 'unsupported';
  message: string;
}

export class ContextAttachmentManager {
  private readonly onState: (state: AttachmentState) => void;
  private readonly onError: (error: AttachmentError) => void;
  /** wire inventory 解析 dsh-file-attach 插件身份(webview 驱动 client half 激活用) */
  private readonly resolveCordis: () => Promise<AttachmentState['cordis']>;
  private readonly disposables: vscode.Disposable[] = [];
  private attachments: AttachmentRef[] = [];
  private activeFile: AttachmentState['activeFile'];
  private selections: readonly SelectionSummary[] = [];
  private selectionTimer: NodeJS.Timeout | undefined;
  private cordis: AttachmentState['cordis'] = null;
  private cordisCheckedAt = 0;

  constructor(
    onState: (state: AttachmentState) => void,
    onError: (error: AttachmentError) => void,
    resolveCordis: () => Promise<AttachmentState['cordis']>,
  ) {
    this.onState = onState;
    this.onError = onError;
    this.resolveCordis = resolveCordis;
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.recomputeEditor()),
      vscode.window.onDidChangeTextEditorSelection(() => this.scheduleRecomputeEditor(50)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('deepseekHarness.context.attachActiveFile') ||
          e.affectsConfiguration('deepseekHarness.context.attachSelection')
        ) {
          this.pushState();
        }
      }),
    );
    this.recomputeEditor();
  }

  dispose(): void {
    if (this.selectionTimer !== undefined) clearTimeout(this.selectionTimer);
    for (const d of this.disposables) d.dispose();
  }

  // ---- 状态 ----

  getState(): AttachmentState {
    const cfg = vscode.workspace.getConfiguration('deepseekHarness');
    return {
      activeFileEnabled: cfg.get<boolean>('context.attachActiveFile', false),
      selectionEnabled: cfg.get<boolean>('context.attachSelection', false),
      activeFileAvailable: this.activeFile !== undefined,
      selectionAvailable: this.selections.length > 0,
      activeFile: this.activeFile,
      selections: this.selections,
      attachments: this.attachments,
      cordis: this.cordis,
    };
  }

  private pushState(): void {
    void this.refreshCordisIfStale();
    this.onState(this.getState());
  }

  /** 立即推送当前状态(webview ready 时显式调用;触发一次 cordis 解析) */
  pushNow(): void {
    this.pushState();
  }

  /** cordis 身份缓存 30s 后经 wire inventory 重解析;值变化时再推一次状态
   * (webview 据此驱动插件 client half 激活)。失败置 0 下次再试。 */
  private async refreshCordisIfStale(): Promise<void> {
    const now = Date.now();
    if (this.cordisCheckedAt !== 0 && now - this.cordisCheckedAt < 30_000) return;
    this.cordisCheckedAt = now;
    try {
      const next = await this.resolveCordis();
      if (JSON.stringify(next) !== JSON.stringify(this.cordis)) {
        this.cordis = next;
        this.onState(this.getState());
      }
    } catch {
      this.cordisCheckedAt = 0;
    }
  }

  /** 编辑器变化即时刷新;选区变化 50ms 防抖(拖选产生大量事件)。 */
  private scheduleRecomputeEditor(delayMs: number): void {
    if (this.selectionTimer !== undefined) clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => {
      this.selectionTimer = undefined;
      this.recomputeEditor();
    }, delayMs);
  }

  private recomputeEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      this.activeFile = undefined;
      this.selections = [];
      this.pushState();
      return;
    }
    const doc = editor.document;
    this.activeFile = {
      path:
        doc.isUntitled
          ? doc.uri.toString()
          : vscode.workspace.asRelativePath(doc.uri, false) || doc.fileName,
      // 绝对路径(插件建议附着用;untitled 无 fsPath 置空,webview 侧跳过建议)
      fsPath: doc.isUntitled ? '' : doc.uri.fsPath,
      languageId: doc.languageId,
      isDirty: doc.isDirty,
      isUntitled: doc.isUntitled,
    };
    this.selections = editor.selections
      .filter((s) => !s.isEmpty)
      .map((s) => {
        const text = doc.getText(s);
        const info = toSelectionInfo(s.start.line, s.start.character, s.end.line, s.end.character, text);
        return {
          startLine: info.startLine,
          startCol: info.startCol,
          endLine: info.endLine,
          endCol: info.endCol,
          charCount: text.length,
        };
      });
    this.pushState();
  }

  // ---- 开关 ----

  async setActiveFileEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration('deepseekHarness').update('context.attachActiveFile', enabled, true);
    this.pushState();
  }

  async setSelectionEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration('deepseekHarness').update('context.attachSelection', enabled, true);
    this.pushState();
  }

  // ---- 拖入文件 ----

  /** 拖入 URI 列表:校验 + stat + 目录拒绝 + 去重 + 上限;逐条报错不中断。 */
  async addUris(uris: readonly string[]): Promise<void> {
    const added: AttachmentRef[] = [];
    for (const raw of uris) {
      if (raw.length > 8_192) {
        this.postError('invalid-uri', 'URI 过长');
        continue;
      }
      let uri: vscode.Uri;
      try {
        uri = vscode.Uri.parse(raw);
      } catch {
        this.postError('invalid-uri', `无法解析 URI:${raw.slice(0, 80)}`);
        continue;
      }
      if (uri.scheme === '') {
        this.postError('invalid-uri', `URI 缺少 scheme:${raw.slice(0, 80)}`);
        continue;
      }
      const uriString = uri.toString();
      if (this.attachments.some((a) => a.uri === uriString)) continue; // 去重
      if (this.attachments.length + added.length >= MAX_ATTACHMENTS) {
        this.postError('unsupported', `附件数已达上限(${MAX_ATTACHMENTS})`);
        continue;
      }
      let stat: vscode.FileStat;
      try {
        stat = await vscode.workspace.fs.stat(uri);
      } catch {
        this.postError('unreadable', `无法读取文件:${nameFromUri(raw)}`);
        continue;
      }
      if (stat.type & vscode.FileType.Directory) {
        this.postError('directory', `目录暂不支持,请拖入文件:${nameFromUri(raw)}`);
        continue;
      }
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      added.push({
        id: randomUUID(),
        uri: uriString,
        name: nameFromUri(raw),
        size: stat.size,
        displayPath:
          folder !== undefined
            ? vscode.workspace.asRelativePath(uri, false)
            : uri.fsPath !== '' ? uri.fsPath : uriString,
        outsideWorkspace: folder === undefined,
      });
    }
    if (added.length > 0) {
      this.attachments = [...this.attachments, ...added];
      this.pushState();
    }
  }

  removeAttachment(id: string): void {
    const next = this.attachments.filter((a) => a.id !== id);
    if (next.length !== this.attachments.length) {
      this.attachments = next;
      this.pushState();
    }
  }

  private postError(code: AttachmentError['code'], message: string): void {
    this.onError({ code, message });
  }

  // ---- 发送瞬间快照 ----

  async collectForSend(options: CollectSendOptions): Promise<{ text: string; warnings: string[] }> {
    const cfg = vscode.workspace.getConfiguration('deepseekHarness');
    const attachActiveFile = cfg.get<boolean>('context.attachActiveFile', false);
    const attachSelection = cfg.get<boolean>('context.attachSelection', false);
    const editor = vscode.window.activeTextEditor;

    // 活动编辑器快照(需求 2/3:发送瞬间读取,含未保存改动)
    let activeFile: { path: string; languageId: string; isDirty: boolean; isUntitled: boolean } | undefined;
    let fullFileText: string | undefined;
    let selections: SelectionInfo[] = [];
    let selectionWholeFile = false;
    if (editor !== undefined) {
      const doc = editor.document;
      activeFile = {
        path:
          doc.isUntitled
            ? doc.uri.toString()
            : vscode.workspace.asRelativePath(doc.uri, false) || doc.fileName,
        languageId: doc.languageId,
        isDirty: doc.isDirty,
        isUntitled: doc.isUntitled,
      };
      if (attachActiveFile) fullFileText = doc.getText();
      if (attachSelection) {
        selections = editor.selections
          .filter((s) => !s.isEmpty)
          .map((s) => toSelectionInfo(s.start.line, s.start.character, s.end.line, s.end.character, doc.getText(s)));
        // 选区覆盖整个文件 → 与 full-file 去重(单选区全选)
        if (selections.length === 1 && !doc.isUntitled) {
          const last = doc.lineAt(doc.lineCount - 1);
          selectionWholeFile = isWholeFileSelection(selections[0]!, doc.lineCount, last.text.length);
        }
      }
    }

    // 附件读取(发送时;1 MiB 上限 / 二进制检测 / 20k 截断)
    const attachments = [];
    for (const ref of this.attachments) {
      let body: { kind: 'content' | 'too-large' | 'binary' | 'unreadable'; text?: string; size?: number; message?: string };
      try {
        const uri = vscode.Uri.parse(ref.uri);
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_ATTACHMENT_BYTES) {
          body = { kind: 'too-large', size: stat.size };
        } else {
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (looksBinary(bytes)) {
            body = { kind: 'binary', size: stat.size };
          } else {
            const text = new TextDecoder('utf-8').decode(bytes);
            body = { kind: 'content', text };
          }
        }
      } catch (error) {
        body = { kind: 'unreadable', message: error instanceof Error ? error.message : String(error) };
      }
      attachments.push({ id: ref.id, name: ref.name, displayPath: ref.displayPath, outsideWorkspace: ref.outsideWorkspace, languageId: ref.languageId, body });
    }

    return formatSendContext({
      activeFile,
      fullFileText,
      attachActiveFile,
      attachSelection,
      selections,
      selectionWholeFile,
      diagnostics: options.diagnostics,
      gitChanges: options.gitChanges,
      attachments,
      caps: { perFileChars: PER_FILE_CHARS, totalChars: TOTAL_CHARS },
    });
  }
}

