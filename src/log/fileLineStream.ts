import * as fs from 'fs';
import * as readline from 'readline';

export async function forEachLineChunk(
  filePath: string,
  chunkSize: number,
  options: {
    fileSize: number;
    shouldContinue: () => boolean;
    onChunk: (lines: string[], lineOffset: number) => void | Promise<void>;
    onProgress?: (percent: number) => void;
  },
): Promise<void> {
  const { fileSize, shouldContinue, onChunk, onProgress } = options;
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineOffset = 0;
  let buffer: string[] = [];

  stream.on('data', () => {
    if (fileSize > 0 && onProgress) {
      onProgress(Math.min(99, Math.round((stream.bytesRead / fileSize) * 100)));
    }
  });

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) {
      return;
    }
    const chunk = buffer;
    buffer = [];
    await onChunk(chunk, lineOffset);
    lineOffset += chunk.length;
  };

  try {
    for await (const line of rl) {
      if (!shouldContinue()) {
        throw new Error('Parse cancelled');
      }
      buffer.push(line);
      if (buffer.length >= chunkSize) {
        await flush();
      }
    }
    await flush();
  } finally {
    rl.close();
    stream.destroy();
  }
}
