import { describe, expect, it } from 'vitest';
import {
  adbNamesForPlatform,
  configuredAdbCandidates,
  resolveAdbFromPathEnv,
  splitPathEnv,
} from '../src/adb/adbPathCore';
import { parseAdbDevicesOutput } from '../src/adb/listDevices';
import { shouldDeferQueryFilter } from '../src/capture/recordingFilter';

describe('adbPathCore', () => {
  it('prefers configured path before PATH scan', () => {
    const candidates = configuredAdbCandidates('/opt/android/adb', false);
    expect(candidates).toEqual(['/opt/android/adb']);
  });

  it('adds .exe candidate on Windows for configured path', () => {
    const candidates = configuredAdbCandidates('C:\\sdk\\adb', true);
    expect(candidates).toEqual(['C:\\sdk\\adb', 'C:\\sdk\\adb.exe']);
  });

  it('splits PATH with platform separator', () => {
    expect(splitPathEnv('/a:/b', false)).toEqual(['/a', '/b']);
    expect(splitPathEnv('C:\\a;C:\\b', true)).toEqual(['C:\\a', 'C:\\b']);
  });

  it('finds adb on PATH', () => {
    const found = resolveAdbFromPathEnv('/x:/y', false, (p) => p === '/y/adb');
    expect(found).toBe('/y/adb');
    expect(adbNamesForPlatform(true)).toContain('adb.exe');
  });
});

describe('parseAdbDevicesOutput', () => {
  it('parses device lines', () => {
    const out = parseAdbDevicesOutput(`
List of devices attached
emulator-5554\tdevice product:sdk
ABC123\tunauthorized
XYZ789\tdevice
`);
    expect(out.map((d) => d.serial)).toEqual(['emulator-5554', 'ABC123', 'XYZ789']);
    expect(out.filter((d) => d.state === 'device').map((d) => d.serial)).toEqual([
      'emulator-5554',
      'XYZ789',
    ]);
  });
});

describe('shouldDeferQueryFilter', () => {
  it('defers only while live capture is recording', () => {
    expect(shouldDeferQueryFilter('file', true)).toBe(false);
    expect(shouldDeferQueryFilter('liveCapture', false)).toBe(false);
    expect(shouldDeferQueryFilter('liveCapture', true)).toBe(true);
  });
});
