import * as vscode from 'vscode';

export interface LogFilterSettings {
  /** 0 disables the confirmation dialog. */
  confirmBeforeParseBytes: number;
  parseDebounceMs: number;
  queryDebounceMs: number;
}

export function getLogFilterSettings(): LogFilterSettings {
  const config = vscode.workspace.getConfiguration('logFilter');
  const confirmMb = config.get<number>('confirmBeforeParseSizeMB', 0);
  return {
    confirmBeforeParseBytes: Math.max(0, confirmMb) * 1024 * 1024,
    parseDebounceMs: Math.max(0, config.get<number>('parseDebounceMs', 200)),
    queryDebounceMs: Math.max(0, config.get<number>('queryDebounceMs', 300)),
  };
}
