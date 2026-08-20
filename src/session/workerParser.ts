import * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import * as path from 'path';
import type { ParseResult } from '../types';
import { WORKER_CHUNK_LINES } from '../constants';
import { forEachLineChunk } from '../log/fileLineStream';
import { logError } from '../logChannel';

export interface ScanProgress {
  linesProcessed: number;
  entryCount: number;
  percent?: number;
}

export interface IndexMeta {
  totalEntries: number;
  fileMaxTime?: number;
  format: ParseResult['format'];
  tags: string[];
}

export type IndexSource =
  | {
      kind: 'file';
      sourceUri: string;
      filePath: string;
      fileSize: number;
      fileMtimeMs: number;
    }
  | {
      kind: 'document';
      sourceUri: string;
      doc: vscode.TextDocument;
      fileMtimeMs: number;
    };

export class WorkerParser {
  private worker?: Worker;
  private parseVersion = 0;
  private cacheKey?: string;
  private indexMeta?: IndexMeta;
  private pendingFilterJob?: {
    query: string;
    generation: number;
    resolve: (result: ParseResult) => void;
    reject: (err: Error) => void;
  };
  private filterDraining = false;

  constructor(private extensionPath: string) {}

  get isIndexed(): boolean {
    return this.indexMeta !== undefined && this.worker !== undefined;
  }

  matchesCache(cacheKey: string): boolean {
    return this.isIndexed && this.cacheKey === cacheKey;
  }

  getIndexMeta(): IndexMeta | undefined {
    return this.indexMeta;
  }

  invalidate(): void {
    this.cacheKey = undefined;
    this.indexMeta = undefined;
    this.cancelPendingFilter();
    if (this.worker) {
      this.worker.postMessage({ type: 'cancel', version: this.parseVersion });
      this.worker.removeAllListeners();
      this.worker.terminate();
      this.worker = undefined;
    }
    this.parseVersion++;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      const workerPath = path.join(this.extensionPath, 'dist', 'logParser.worker.js');
      this.worker = new Worker(workerPath);
    }
    return this.worker;
  }

  async buildIndexFromFile(
    cacheKey: string,
    filePath: string,
    fileSize: number,
    fileMtimeMs: number,
    version: number,
    onScan?: (progress: ScanProgress) => void,
    sourceUri?: string,
  ): Promise<IndexMeta> {
    return this.buildIndexFromSources(
      cacheKey,
      [
        {
          kind: 'file',
          sourceUri: sourceUri ?? filePath,
          filePath,
          fileSize,
          fileMtimeMs,
        },
      ],
      version,
      onScan,
    );
  }

  async buildIndexFromDocument(
    cacheKey: string,
    doc: vscode.TextDocument,
    fileMtimeMs: number,
    version: number,
    onScan?: (progress: ScanProgress) => void,
  ): Promise<IndexMeta> {
    return this.buildIndexFromSources(
      cacheKey,
      [
        {
          kind: 'document',
          sourceUri: doc.uri.toString(),
          doc,
          fileMtimeMs,
        },
      ],
      version,
      onScan,
    );
  }

  async buildIndexFromSources(
    cacheKey: string,
    sources: IndexSource[],
    version: number,
    onScan?: (progress: ScanProgress) => void,
  ): Promise<IndexMeta> {
    if (sources.length === 0) {
      throw new Error('No sources to index');
    }
    if (this.matchesCache(cacheKey)) {
      return this.indexMeta!;
    }
    this.invalidate();
    this.cacheKey = cacheKey;
    const worker = this.ensureWorker();
    this.parseVersion = version;

    const fileMtimeMs = Math.max(...sources.map((s) => s.fileMtimeMs));
    let latest: ScanProgress = { linesProcessed: 0, entryCount: 0 };
    const reportScan = (patch: Partial<ScanProgress>) => {
      latest = { ...latest, ...patch };
      onScan?.(latest);
    };

    const sourceCount = sources.length;

    await this.runParse(
      worker,
      version,
      (w, v) => w.postMessage({ type: 'init', fileMtimeMs, version: v }),
      async (w, v, shouldContinue) => {
        for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
          const source = sources[sourceIndex];
          if (!shouldContinue()) {
            throw new Error('Parse cancelled');
          }
          const basePercent = Math.round((sourceIndex / sourceCount) * 100);
          const span = Math.round(100 / sourceCount);

          if (source.kind === 'file') {
            await forEachLineChunk(source.filePath, WORKER_CHUNK_LINES, {
              fileSize: source.fileSize,
              shouldContinue,
              onProgress: (percent) => {
                reportScan({
                  percent: Math.min(99, basePercent + Math.round((percent / 100) * span)),
                });
              },
              onChunk: (lines, lineOffset) =>
                this.postChunk(w, v, lines, lineOffset, shouldContinue, source.sourceUri),
            });
          } else {
            const totalLines = source.doc.lineCount;
            let lineIndex = 0;
            while (lineIndex < totalLines) {
              if (!shouldContinue()) {
                throw new Error('Parse cancelled');
              }
              const end = Math.min(lineIndex + WORKER_CHUNK_LINES, totalLines);
              const lines: string[] = [];
              for (let i = lineIndex; i < end; i++) {
                lines.push(source.doc.lineAt(i).text);
              }
              await this.postChunk(w, v, lines, lineIndex, shouldContinue, source.sourceUri);
              lineIndex = end;
              reportScan({
                percent: Math.min(
                  99,
                  basePercent +
                    Math.round((lineIndex / Math.max(1, totalLines)) * span),
                ),
              });
            }
          }
        }
      },
      reportScan,
    );

    return this.indexMeta!;
  }

  filterQuery(query: string, generation: number): Promise<ParseResult> {
    if (!this.worker || !this.indexMeta) {
      return Promise.reject(new Error('Log index not ready'));
    }

    return new Promise((resolve, reject) => {
      if (this.pendingFilterJob) {
        this.pendingFilterJob.reject(new Error('Filter superseded'));
      }
      this.pendingFilterJob = { query, generation, resolve, reject };
      void this.drainFilterQueue();
    });
  }

  private cancelPendingFilter(): void {
    if (this.pendingFilterJob) {
      this.pendingFilterJob.reject(new Error('Filter superseded'));
      this.pendingFilterJob = undefined;
    }
  }

  private async drainFilterQueue(): Promise<void> {
    if (this.filterDraining) {
      return;
    }
    this.filterDraining = true;
    try {
      while (this.pendingFilterJob) {
        const job = this.pendingFilterJob;
        this.pendingFilterJob = undefined;
        try {
          const result = await this.executeFilter(job.query, job.generation);
          if (this.pendingFilterJob) {
            job.reject(new Error('Filter superseded'));
            continue;
          }
          job.resolve(result);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (this.pendingFilterJob) {
            job.reject(new Error('Filter superseded'));
            continue;
          }
          job.reject(error);
        }
      }
    } finally {
      this.filterDraining = false;
      if (this.pendingFilterJob) {
        void this.drainFilterQueue();
      }
    }
  }

  private executeFilter(query: string, generation: number): Promise<ParseResult> {
    const worker = this.worker!;
    return new Promise((resolve, reject) => {
      const onMessage = (msg: {
        type: string;
        result?: ParseResult;
        version?: number;
        error?: string;
      }) => {
        if (msg.version !== generation) {
          return;
        }
        switch (msg.type) {
          case 'filtered':
            worker.off('message', onMessage);
            resolve(msg.result!);
            break;
          case 'error':
            worker.off('message', onMessage);
            reject(new Error(msg.error ?? 'Filter error'));
            break;
        }
      };
      worker.on('message', onMessage);
      worker.postMessage({ type: 'filter', query, version: generation });
    });
  }

  dispose(): void {
    this.invalidate();
  }

  private postChunk(
    worker: Worker,
    version: number,
    lines: string[],
    lineOffset: number,
    shouldContinue: () => boolean,
    sourceUri?: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!shouldContinue()) {
        reject(new Error('Parse cancelled'));
        return;
      }
      const onMessage = (msg: { type: string; version?: number }) => {
        if (msg.type === 'chunkAck' && msg.version === version) {
          worker.off('message', onMessage);
          resolve();
        }
      };
      worker.on('message', onMessage);
      worker.postMessage({ type: 'chunk', lines, lineOffset, version, sourceUri });
    });
  }

  private runParse(
    worker: Worker,
    version: number,
    init: (worker: Worker, version: number) => void,
    feed: (
      worker: Worker,
      version: number,
      shouldContinue: () => boolean,
    ) => Promise<void>,
    onScan?: (progress: ScanProgress) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const shouldContinue = () => !settled && version === this.parseVersion;

      const fail = (err: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        worker.removeAllListeners('message');
        reject(err);
      };

      worker.on('message', (msg: {
        type: string;
        meta?: IndexMeta;
        version?: number;
        error?: string;
        linesProcessed?: number;
        entryCount?: number;
      }) => {
        if (msg.version !== undefined && msg.version !== version) {
          return;
        }
        switch (msg.type) {
          case 'ready':
            void feed(worker, version, shouldContinue)
              .then(() => {
                if (shouldContinue()) {
                  worker.postMessage({ type: 'finish', version });
                }
              })
              .catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
            break;
          case 'progress':
            onScan?.({
              linesProcessed: msg.linesProcessed ?? 0,
              entryCount: msg.entryCount ?? 0,
            });
            break;
          case 'parsed':
            if (settled) {
              return;
            }
            settled = true;
            this.indexMeta = msg.meta!;
            worker.removeAllListeners('message');
            resolve();
            break;
          case 'cancelled':
            fail(new Error('Parse cancelled'));
            break;
          case 'error':
            fail(new Error(msg.error ?? 'Worker error'));
            break;
        }
      });

      worker.on('error', (err) => {
        logError('Worker thread error', err);
        fail(err instanceof Error ? err : new Error(String(err)));
      });

      init(worker, version);
    });
  }
}
