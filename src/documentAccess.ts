export interface TextDocumentSnapshot {
  lineCount: number;
  lineAt?(line: number): { text: string };
}

/** True when the extension host exposes readable line content (not large-file stub mode). */
export function isDocumentReadable(doc: TextDocumentSnapshot): boolean {
  if (doc.lineCount === 0) {
    return false;
  }
  if (!doc.lineAt) {
    return false;
  }
  try {
    doc.lineAt(0);
    return true;
  } catch {
    return false;
  }
}
