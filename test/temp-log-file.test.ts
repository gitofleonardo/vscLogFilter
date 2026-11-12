import { describe, expect, it } from 'vitest';
import {
  isVscLogFilterTempCaptureLogFsPath,
  isVscLogFilterTempCaptureLogUri,
} from '../src/capture/tempCaptureLogPath';

describe('vscLogFilter temp capture log paths', () => {
  it('recognizes mkdtemp capture.log paths', () => {
    expect(
      isVscLogFilterTempCaptureLogFsPath('/tmp/vscLogFilter-abc123/capture.log'),
    ).toBe(true);
    expect(
      isVscLogFilterTempCaptureLogFsPath('C:\\Users\\x\\AppData\\Local\\Temp\\vscLogFilter-xyz\\capture.log'),
    ).toBe(true);
  });

  it('rejects normal logs and other temps', () => {
    expect(isVscLogFilterTempCaptureLogFsPath('/tmp/capture.log')).toBe(false);
    expect(isVscLogFilterTempCaptureLogFsPath('/tmp/vscLogFilter-abc/other.log')).toBe(false);
    expect(isVscLogFilterTempCaptureLogFsPath('/project/capture.log')).toBe(false);
  });

  it('parses file URIs', () => {
    expect(
      isVscLogFilterTempCaptureLogUri('file:///tmp/vscLogFilter-abc/capture.log'),
    ).toBe(true);
    expect(isVscLogFilterTempCaptureLogUri('file:///tmp/test.txt')).toBe(false);
  });
});
