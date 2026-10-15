import { createWriteStream } from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/** Same append pattern as LogcatCapture stdout → file. */
function appendChunks(logPath: string, chunks: Buffer[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(logPath, { flags: 'a' });
    stream.on('error', reject);
    for (const chunk of chunks) {
      stream.write(chunk);
    }
    stream.end(() => resolve());
  });
}

describe('capture log append pipe', () => {
  it('writes adb stdout chunks verbatim to the log file', async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'vscLogFilter-pipe-'));
    const logPath = path.join(dir, 'capture.log');
    await appendChunks(logPath, [
      Buffer.from('01-01 00:00:00.000  1  2 I Tag: msg1\n'),
      Buffer.from('01-01 00:00:00.001  1  2 I Tag: msg2\n'),
    ]);
    const text = await fsPromises.readFile(logPath, 'utf8');
    expect(text).toBe(
      '01-01 00:00:00.000  1  2 I Tag: msg1\n01-01 00:00:00.001  1  2 I Tag: msg2\n',
    );
    await fsPromises.rm(dir, { recursive: true, force: true });
  });
});
