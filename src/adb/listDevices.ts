import { spawn } from 'child_process';

export interface AdbDevice {
  serial: string;
  state: string;
  label: string;
}

function runAdb(adbPath: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(adbPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

/** Parse `adb devices` output; returns devices in `device` state. */
export function parseAdbDevicesOutput(output: string): AdbDevice[] {
  const devices: AdbDevice[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('List of devices')) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      continue;
    }
    const serial = parts[0];
    const state = parts[1];
    const extra = parts.slice(2).join(' ');
    devices.push({
      serial,
      state,
      label: extra ? `${serial} (${extra})` : serial,
    });
  }
  return devices;
}

export async function listAdbDevices(adbPath: string): Promise<AdbDevice[]> {
  const { stdout, code } = await runAdb(adbPath, ['devices']);
  if (code !== 0) {
    return [];
  }
  return parseAdbDevicesOutput(stdout).filter((d) => d.state === 'device');
}
