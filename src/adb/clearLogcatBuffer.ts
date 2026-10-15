import { spawn } from 'child_process';
import { logInfo, logError } from '../logChannel';

function runAdb(adbPath: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(adbPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

/** Clear device logcat ring buffers (`adb logcat -c`). Returns false on failure. */
export async function clearLogcatBuffer(adbPath: string, serial: string): Promise<boolean> {
  try {
    const { code, stderr } = await runAdb(adbPath, ['-s', serial, 'logcat', '-c']);
    if (code === 0) {
      logInfo(`adb logcat -c succeeded for ${serial}`);
      return true;
    }
    const detail = stderr.trim() || `exit code ${code}`;
    logError(`adb logcat -c failed for ${serial}: ${detail}`);
    return false;
  } catch (err) {
    logError(`adb logcat -c failed for ${serial}`, err);
    return false;
  }
}
