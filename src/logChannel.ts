import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getLogChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Log Filter');
  }
  return channel;
}

export function logInfo(message: string): void {
  getLogChannel().appendLine(`[INFO] ${message}`);
}

export function logError(message: string, err?: unknown): void {
  const ch = getLogChannel();
  ch.appendLine(`[ERROR] ${message}`);
  if (err === undefined) {
    return;
  }
  if (err instanceof Error) {
    ch.appendLine(err.message);
    if (err.stack) {
      ch.appendLine(err.stack);
    }
    return;
  }
  ch.appendLine(String(err));
}
