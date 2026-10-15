import * as fs from 'fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { logError, logInfo } from '../logChannel';

export type CaptureStatus = 'idle' | 'recording' | 'error';

export interface CaptureProcessEndedInfo {
  intentional: boolean;
  error?: string;
}

export class LogcatCapture {
  private proc?: ChildProcessWithoutNullStreams;
  private writeStream?: fs.WriteStream;
  private status: CaptureStatus = 'idle';
  private lastError?: string;
  private intentionalStop = false;
  private endedNotified = false;
  private onProcessEnded?: (info: CaptureProcessEndedInfo) => void;

  get captureStatus(): CaptureStatus {
    return this.status;
  }

  get errorMessage(): string | undefined {
    return this.lastError;
  }

  isRecording(): boolean {
    return this.status === 'recording';
  }

  setOnProcessEnded(handler: (info: CaptureProcessEndedInfo) => void): void {
    this.onProcessEnded = handler;
  }

  async start(adbPath: string, serial: string, logPath: string): Promise<void> {
    if (this.isRecording()) {
      return;
    }
    this.lastError = undefined;
    this.endedNotified = false;
    this.writeStream = fs.createWriteStream(logPath, { flags: 'a' });
    const args = ['-s', serial, 'logcat', '-v', 'threadtime'];
    this.proc = spawn(adbPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.status = 'recording';
    logInfo(`adb logcat started for device ${serial}`);

    this.proc.stdout.on('data', (chunk: Buffer) => {
      if (this.writeStream && !this.writeStream.destroyed) {
        this.writeStream.write(chunk);
      }
    });

    this.proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        logInfo(`adb stderr: ${text}`);
        this.lastError = text;
      }
    });

    this.proc.on('error', (err) => {
      this.lastError = String(err);
      this.status = 'error';
      logError('adb logcat process error', err);
      this.notifyProcessEnded(false);
    });

    this.proc.on('close', (code, signal) => {
      const wasRecording = this.status === 'recording';
      if (wasRecording) {
        const intentional =
          this.intentionalStop || signal === 'SIGTERM' || signal === 'SIGKILL';
        if (intentional) {
          this.status = 'idle';
        } else {
          this.status = 'error';
          if (code !== 0 && code !== null) {
            this.lastError =
              this.lastError ?? `adb logcat exited with code ${code}`;
          } else if (!this.lastError) {
            this.lastError = 'adb logcat stopped unexpectedly (device disconnected?)';
          }
        }
        this.notifyProcessEnded(intentional);
      } else if (this.status === 'error') {
        this.notifyProcessEnded(false);
      }
      this.intentionalStop = false;
      void this.closeWriteStream();
    });
  }

  private notifyProcessEnded(intentional: boolean): void {
    if (this.endedNotified) {
      return;
    }
    this.endedNotified = true;
    this.onProcessEnded?.({
      intentional,
      error: intentional ? undefined : this.lastError,
    });
  }

  async stop(): Promise<void> {
    if (!this.proc && !this.writeStream) {
      this.status = 'idle';
      return;
    }
    this.intentionalStop = true;
    const proc = this.proc;
    this.proc = undefined;
    if (proc) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // ignore
          }
          resolve();
        }, 3000);
        proc.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          proc.kill('SIGTERM');
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }
    await this.closeWriteStream();
    if (this.status === 'recording') {
      this.status = 'idle';
    }
  }

  private closeWriteStream(): Promise<void> {
    const stream = this.writeStream;
    this.writeStream = undefined;
    if (!stream || stream.destroyed) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      stream.end(() => resolve());
    });
  }
}
