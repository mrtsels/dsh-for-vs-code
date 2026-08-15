/**
 * logger.ts — 分级日志,输出到 VS Code OutputChannel(webview 侧不可用)。
 */
import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private readonly channel: vscode.OutputChannel;
  private level: LogLevel;

  constructor(name: string, level: LogLevel = 'info') {
    this.channel = vscode.window.createOutputChannel(name);
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string): void {
    if (this.level === 'debug') this.channel.appendLine(`[debug] ${message}`);
  }

  info(message: string): void {
    if (this.level !== 'error' && this.level !== 'warn') this.channel.appendLine(`[info] ${message}`);
  }

  warn(message: string): void {
    if (this.level !== 'error') this.channel.appendLine(`[warn] ${message}`);
  }

  error(message: string): void {
    this.channel.appendLine(`[error] ${message}`);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
