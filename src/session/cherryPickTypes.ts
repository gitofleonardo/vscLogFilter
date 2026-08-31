import type { SerializedLogEntry } from '../types';

export interface CherryPickItem {
  key: string;
  sourceUri: string;
  lineNumber: number;
  fullText: string;
  fileName?: string;
  tag?: string;
  tagStart?: number;
  tagEnd?: number;
  messageStart?: number;
  messageEnd?: number;
  pickedAt: number;
}

export function cherryPickKey(sourceUri: string, lineNumber: number): string {
  return `${sourceUri}#${lineNumber}`;
}

export function cherryPickItemFromRow(
  row: SerializedLogEntry,
  sourceUri: string,
  pickedAt = Date.now(),
): CherryPickItem {
  const uri = row.sourceUri ?? sourceUri;
  return {
    key: cherryPickKey(uri, row.lineNumber),
    sourceUri: uri,
    lineNumber: row.lineNumber,
    fullText: row.fullText,
    fileName: row.fileName,
    tag: row.tag,
    tagStart: row.tagStart,
    tagEnd: row.tagEnd,
    messageStart: row.messageStart,
    messageEnd: row.messageEnd,
    pickedAt,
  };
}
