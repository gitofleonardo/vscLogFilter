import * as path from 'path';

const ADB_NAMES_UNIX = ['adb'];
const ADB_NAMES_WIN = ['adb.exe', 'adb'];

export function isWindowsPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32';
}

/** Candidate paths from a configured setting (may include or omit .exe on Windows). */
export function configuredAdbCandidates(configured: string, win: boolean): string[] {
  const trimmed = configured.trim();
  if (!trimmed) {
    return [];
  }
  const candidates = [trimmed];
  if (win && !trimmed.toLowerCase().endsWith('.exe')) {
    candidates.push(`${trimmed}.exe`);
  }
  return candidates;
}

/** Resolve adb executable name order for PATH scan. */
export function adbNamesForPlatform(win: boolean): string[] {
  return win ? ADB_NAMES_WIN : ADB_NAMES_UNIX;
}

/** Split PATH env the same way Node spawn would on each OS. */
export function splitPathEnv(pathEnv: string | undefined, win: boolean): string[] {
  if (!pathEnv) {
    return [];
  }
  const sep = win ? ';' : ':';
  return pathEnv.split(sep).filter(Boolean);
}

/** Find first existing adb under PATH directories (sync stat not done here — returns candidate paths). */
export function resolveAdbFromPathEnv(
  pathEnv: string | undefined,
  win: boolean,
  exists: (p: string) => boolean,
): string | undefined {
  const dirs = splitPathEnv(pathEnv, win);
  const names = adbNamesForPlatform(win);
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (exists(full)) {
        return full;
      }
    }
  }
  return undefined;
}
