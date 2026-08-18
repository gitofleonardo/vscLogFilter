import * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import * as path from 'path';
import type { ParseResult } from '../types';

const CHUNK_LINES = 5000;

export class WorkerParser {
  private worker?: Worker;
  private activeVersion = 0;

  constructor(private extensionPath: string) {}

  parseDocument(
    doc: vscode.TextDocument,
    version: number,
    fileMtimeMs: number,
    onProgress?: (percent: number) => void,
  ): Promise<ParseResult> {
    this.cancel();
    this.activeVersion = version;

    return new Promise((resolve, reject) => {
      const workerPath = path.join(this.extensionPath, 'dist', 'logParser.worker.js');
      this.worker = new Worker(workerPath);

      const totalLines = doc.lineCount;
      let lineIndex = 0;
      let pending = 0;
      let finished = false;
      let settled = false;

      const cleanup = () => {
        this.worker?.removeAllListeners();
        this.worker?.terminate();
        if (this.activeVersion === version) {
          this.worker = undefined;
        }
      };

      const fail = (err: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(err);
      };

      const succeed = (result: ParseResult) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      };

      const sendNextChunk = () => {
        if (settled || finished || version !== this.activeVersion) {
          if (!settled && version !== this.activeVersion) {
            fail(new Error('Parse cancelled'));
          }
          return;
        }
        if (lineIndex >= totalLines) {
          if (pending === 0) {
            this.worker?.postMessage({ type: 'finish', version });
          }
          return;
        }
        const end = Math.min(lineIndex + CHUNK_LINES, totalLines);
        const lines: string[] = [];
        for (let i = lineIndex; i < end; i++) {
          lines.push(doc.lineAt(i).text);
        }
        pending++;
        this.worker?.postMessage({ type: 'chunk', lines, lineOffset: lineIndex, version });
        lineIndex = end;
        onProgress?.(Math.min(99, Math.round((lineIndex / totalLines) * 100)));
      };

      this.worker.on('message', (msg: {
        type: string;
        result?: ParseResult;
        version?: number;
        error?: string;
      }) => {
        if (version !== this.activeVersion) {
          return;
        }
        switch (msg.type) {
          case 'ready':
            sendNextChunk();
            break;
          case 'chunkAck':
            pending--;
            sendNextChunk();
            break;
          case 'done':
            finished = true;
            if (msg.version !== version) {
              fail(new Error('Stale parse result'));
              return;
            }
            onProgress?.(100);
            succeed(msg.result!);
            break;
          case 'cancelled':
            fail(new Error('Parse cancelled'));
            break;
          case 'error':
            finished = true;
            fail(new Error(msg.error ?? 'Worker error'));
            break;
        }
      });

      this.worker.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));

      this.worker.postMessage({ type: 'init', fileMtimeMs, version });
    });
  }

  cancel(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'cancel', version: this.activeVersion });
      this.worker.terminate();
      this.worker = undefined;
    }
    this.activeVersion++;
  }

  dispose(): void {
    this.cancel();
  }
}
