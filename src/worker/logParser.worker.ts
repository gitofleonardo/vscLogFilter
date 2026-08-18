import { parentPort } from 'worker_threads';
import {
  createParseAccumulator,
  finalizeParseAccumulator,
  parseLogLinesChunk,
  type LogParseAccumulator,
} from '../log/parser';
import type { ParseResult } from '../types';

interface WorkerState {
  acc: LogParseAccumulator;
  fileMtimeMs: number;
  version: number;
}

let state: WorkerState | null = null;

parentPort?.on('message', (msg: {
  type: string;
  lines?: string[];
  lineOffset?: number;
  fileMtimeMs?: number;
  version?: number;
}) => {
  try {
    switch (msg.type) {
      case 'init':
        state = {
          acc: createParseAccumulator(),
          fileMtimeMs: msg.fileMtimeMs ?? Date.now(),
          version: msg.version ?? 0,
        };
        parentPort?.postMessage({ type: 'ready', version: state.version });
        break;
      case 'chunk': {
        if (!state || msg.version !== state.version) {
          parentPort?.postMessage({ type: 'chunkAck', stale: true });
          return;
        }
        parseLogLinesChunk(state.acc, msg.lines ?? [], msg.lineOffset ?? 0);
        parentPort?.postMessage({ type: 'chunkAck', version: state.version });
        break;
      }
      case 'finish': {
        if (!state || msg.version !== state.version) {
          parentPort?.postMessage({ type: 'cancelled', version: msg.version });
          return;
        }
        const result: ParseResult = finalizeParseAccumulator(state.acc, state.fileMtimeMs);
        const version = state.version;
        state = null;
        parentPort?.postMessage({ type: 'done', result, version });
        break;
      }
      case 'cancel':
        state = null;
        parentPort?.postMessage({ type: 'cancelled', version: msg.version });
        break;
    }
  } catch (err) {
    parentPort?.postMessage({ type: 'error', error: String(err) });
  }
});
