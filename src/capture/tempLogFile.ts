import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface TempLogHandle {
  dir: string;
  logPath: string;
  uri: vscode.Uri;
}

export async function createTempLogFile(): Promise<TempLogHandle> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vscLogFilter-'));
  const logPath = path.join(dir, 'capture.log');
  await fs.writeFile(logPath, '', 'utf8');
  return {
    dir,
    logPath,
    uri: vscode.Uri.file(logPath),
  };
}

export async function removeTempLogDir(dir: string | undefined): Promise<void> {
  if (!dir) {
    return;
  }
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
}
