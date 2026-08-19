import * as vscode from 'vscode';
import { LOGCAT_DETECT_SAMPLE_LINES } from '../constants';
import { isLogcatDocumentContent, isLogcatLine } from './parser';

const LOG_EXT = new Set(['.log', '.txt']);

export function isLogcatDocument(doc: vscode.TextDocument): boolean {
  const ext = doc.fileName.includes('.')
    ? doc.fileName.slice(doc.fileName.lastIndexOf('.')).toLowerCase()
    : '';
  if (LOG_EXT.has(ext)) {
    return true;
  }
  const endLine = Math.min(doc.lineCount, LOGCAT_DETECT_SAMPLE_LINES);
  const sample = doc.getText(new vscode.Range(0, 0, endLine, 0));
  return isLogcatDocumentContent(sample);
}

export function isLogcatEditor(editor: vscode.TextEditor | undefined): boolean {
  return editor !== undefined && isLogcatDocument(editor.document);
}

export { isLogcatLine };
