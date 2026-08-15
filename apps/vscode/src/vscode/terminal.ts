/**
 * terminal.ts — Pseudoterminal 版终端(P2-6):输出经 onDidWrite 捕获回传 UI。
 * 实现:VS Code createTerminal({pty}) + pty 内 spawn shell 执行命令并接管输出
 * (VS Code Terminal API 的标准捕获模式;非"裸 child_process"绕过)。
 * 创建失败降级为普通集成终端(onOutput 收不到输出,UI 提示降级)。
 */
import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'node:child_process';

class CapturingPty implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite = this.writeEmitter.event;
  private readonly closeEmitter = new vscode.EventEmitter<void>();
  readonly onDidClose = this.closeEmitter.event;
  private child: ChildProcess | undefined;

  constructor(
    private readonly command: string,
    private readonly cwd: string | undefined,
    private readonly onOutput?: (text: string) => void,
  ) {}

  open(): void {
    this.writeEmitter.fire(`$ ${this.command}\r\n`);
    const shell = process.env.SHELL ?? '/bin/bash';
    const child = spawn(shell, ['-lc', this.command], { cwd: this.cwd });
    this.child = child;
    const write = (data: Buffer): void => {
      const text = data.toString();
      this.writeEmitter.fire(text);
      this.onOutput?.(text);
    };
    // spawn 默认 stdio 为 pipe,stdout/stderr 一定存在(TS 类型放宽为 null,此处收口)
    if (child.stdout) child.stdout.on('data', write);
    if (child.stderr) child.stderr.on('data', write);
    child.on('error', (error) => {
      // P2-9:启动失败也要收尾(否则死进程终端残留),fire close 供自回收
      this.writeEmitter.fire(`\r\n[dsh] 启动失败:${error.message}\r\n`);
      this.closeEmitter.fire();
    });
    child.on('exit', (code) => {
      this.writeEmitter.fire(`\r\n[dsh] 命令退出,code=${code}\r\n`);
      this.closeEmitter.fire();
    });
  }

  close(): void {
    this.child?.kill();
  }

  handleInput(data: string): void {
    // spawn 默认 stdio 为 pipe,stdin 一定存在(TS 类型放宽为 null,此处收口)
    this.child?.stdin?.write(data);
  }
}

/**
 * 在可捕获输出的 Pseudoterminal 里执行命令;输出实时回传 onOutput。
 * 降级:普通集成终端(输出不可回传)。
 */
export function runCommandInTerminal(
  command: string,
  workspaceRoot: string | undefined,
  onOutput?: (text: string) => void,
): vscode.Terminal {
  try {
    const pty = new CapturingPty(command, workspaceRoot, onOutput);
    const terminal = vscode.window.createTerminal({
      name: 'dsh',
      pty,
      isTransient: true,
    });
    // 命令结束(pty close)后自回收,不留僵尸终端(P2-5)
    const closeDisposable = vscode.window.onDidCloseTerminal((t) => {
      if (t === terminal) {
        closeDisposable.dispose();
        terminal.dispose();
      }
    });
    terminal.show();
    return terminal;
  } catch (error) {
    const terminal = vscode.window.createTerminal({ name: 'dsh', cwd: workspaceRoot });
    terminal.show();
    terminal.sendText(command, true);
    onOutput?.(`[dsh] pty 不可用,已降级为集成终端(${error instanceof Error ? error.message : ''})\r\n`);
    return terminal;
  }
}
