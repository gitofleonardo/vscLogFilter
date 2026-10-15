import * as fs from 'fs/promises';
import { accessSync } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import {
  configuredAdbCandidates,
  isWindowsPlatform,
  resolveAdbFromPathEnv,
} from './adbPathCore';

const VERIFY_TIMEOUT_MS = 8000;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function verifyAdbProcess(adbPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(adbPath, ['version'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      finish(false);
    }, VERIFY_TIMEOUT_MS);
    proc.on('error', () => finish(false));
    proc.on('close', (code) => finish(code === 0));
  });
}

export async function resolveAdbExecutable(): Promise<string | undefined> {
  const win = isWindowsPlatform();
  const configured = vscode.workspace.getConfiguration('logFilter').get<string>('adbPath', '');

  for (const candidate of configuredAdbCandidates(configured, win)) {
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
    if (await pathExists(resolved)) {
      if (await verifyAdbProcess(resolved)) {
        return resolved;
      }
    }
  }

  if (configured.trim()) {
    return undefined;
  }

  const fromPath = resolveAdbFromPathEnv(process.env.PATH, win, (p) => {
    try {
      accessSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (fromPath && (await verifyAdbProcess(fromPath))) {
    return fromPath;
  }
  return undefined;
}

export { verifyAdbProcess };
