export type ParseSource = 'disk' | 'document';

export interface ParseDocumentSnapshot {
  lineCount: number;
  isClosed?: boolean;
  lineAt?(line: number): { text: string };
}

/**
 * Prefer the in-memory document when VS Code exposes readable content (keeps unsaved edits).
 * Fall back to disk for local files when the editor buffer is missing or unusable
 * (e.g. VS Code large-file mode without a usable TextDocument).
 */
export function chooseParseSource(
  uriScheme: string,
  doc: ParseDocumentSnapshot | undefined,
  fileSize: number,
): ParseSource {
  if (uriScheme !== 'file') {
    return 'document';
  }
  if (!doc || doc.isClosed) {
    return 'disk';
  }
  if (fileSize > 0 && doc.lineCount === 0) {
    return 'disk';
  }
  if (doc.lineAt) {
    try {
      doc.lineAt(0);
    } catch {
      return 'disk';
    }
  }
  return 'document';
}
