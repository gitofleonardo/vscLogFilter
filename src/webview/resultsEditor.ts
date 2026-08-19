import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

export interface ResultRow {
  id: number;
  fullText: string;
  lineNumber: number;
}

export interface HighlightTerm {
  text: string;
  exact?: boolean;
}

declare global {
  interface Window {
    LOG_FILTER_WORKER_URI?: string;
  }
}

(globalThis as unknown as { MonacoEnvironment: { getWorkerUrl: () => string } }).MonacoEnvironment = {
  getWorkerUrl: () => window.LOG_FILTER_WORKER_URI ?? '',
};

let editor: monaco.editor.IStandaloneCodeEditor | undefined;
let lineMap: number[] = [];
let decorationIds: string[] = [];

function isDarkTheme(): boolean {
  return document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast');
}

function applyEditorTheme(): void {
  monaco.editor.setTheme(isDarkTheme() ? 'vs-dark' : 'vs');
}

function editorFontFamily(): string {
  const fromTheme = getComputedStyle(document.body)
    .getPropertyValue('--vscode-editor-font-family')
    .trim();
  return fromTheme || 'Consolas, "Courier New", monospace';
}

export function initResultsEditor(
  container: HTMLElement,
  onGoToSource: (sourceLine: number) => void,
): void {
  applyEditorTheme();

  editor = monaco.editor.create(container, {
    readOnly: true,
    language: 'plaintext',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    automaticLayout: true,
    fontFamily: editorFontFamily(),
    fontSize: 13,
    lineNumbers: (lineNo) => {
      const src = lineMap[lineNo - 1];
      return src >= 0 ? String(src + 1) : String(lineNo);
    },
    renderLineHighlight: 'line',
    contextmenu: true,
    find: {
      addExtraSpaceOnTop: false,
      autoFindInSelection: 'never',
      seedSearchStringFromSelection: 'never',
    },
  });

  editor.onMouseDown((e) => {
    if (e.event.detail !== 2 || !e.target.position) {
      return;
    }
    const sourceLine = lineMap[e.target.position.lineNumber - 1];
    if (sourceLine >= 0) {
      onGoToSource(sourceLine);
    }
  });

  editor.addCommand(monaco.KeyCode.Enter, () => {
    const pos = editor?.getPosition();
    if (!pos) {
      return;
    }
    const sourceLine = lineMap[pos.lineNumber - 1];
    if (sourceLine >= 0) {
      onGoToSource(sourceLine);
    }
  });
}

export function setResultsContent(
  rows: ResultRow[] | undefined,
  highlightTerms: HighlightTerm[],
  placeholder: string,
): void {
  if (!editor) {
    return;
  }

  const model = editor.getModel();
  const scrollTop = editor.getScrollTop();

  if (!rows || rows.length === 0) {
    lineMap = [-1];
    editor.setValue(placeholder);
    decorationIds = editor.deltaDecorations(decorationIds, []);
    editor.updateOptions({ lineNumbers: (lineNo) => String(lineNo) });
    return;
  }

  const lines: string[] = [];
  lineMap = [];
  for (const row of rows) {
    const parts = (row.fullText || '').split('\n');
    for (let i = 0; i < parts.length; i++) {
      lines.push(parts[i] ?? '');
      lineMap.push(row.lineNumber + i);
    }
  }

  editor.updateOptions({
    lineNumbers: (lineNo) => {
      const src = lineMap[lineNo - 1];
      return src >= 0 ? String(src + 1) : String(lineNo);
    },
  });

  const text = lines.join('\n');
  if (model && model.getValueLength() === text.length && model.getValue() === text) {
    applyHighlightDecorations(highlightTerms);
    return;
  }

  editor.setValue(text);
  applyHighlightDecorations(highlightTerms);
  editor.setScrollTop(scrollTop);
}

function applyHighlightDecorations(highlightTerms: HighlightTerm[]): void {
  if (!editor) {
    return;
  }
  const model = editor.getModel();
  if (!model) {
    return;
  }

  const decorations: monaco.editor.IModelDeltaDecoration[] = [];
  const lineCount = model.getLineCount();

  for (let lineIndex = 1; lineIndex <= lineCount; lineIndex++) {
    const lineText = model.getLineContent(lineIndex);
    const hay = lineText.toLowerCase();

    for (const term of highlightTerms) {
      if (!term.text) {
        continue;
      }
      const needle = term.text.toLowerCase();
      if (term.exact) {
        let idx = 0;
        while (idx <= hay.length) {
          if (hay.slice(idx, idx + needle.length) === needle) {
            const before = idx === 0 || /\s/.test(hay[idx - 1] ?? '');
            const after =
              idx + needle.length === hay.length || /\s/.test(hay[idx + needle.length] ?? '');
            if (before && after) {
              decorations.push({
                range: new monaco.Range(lineIndex, idx + 1, lineIndex, idx + 1 + needle.length),
                options: { inlineClassName: 'logfilter-term-highlight' },
              });
            }
            idx += needle.length;
          } else {
            idx++;
          }
        }
        continue;
      }
      let idx = 0;
      while (idx < hay.length) {
        const found = hay.indexOf(needle, idx);
        if (found === -1) {
          break;
        }
        decorations.push({
          range: new monaco.Range(lineIndex, found + 1, lineIndex, found + 1 + needle.length),
          options: { inlineClassName: 'logfilter-term-highlight' },
        });
        idx = found + 1;
      }
    }
  }

  decorationIds = editor.deltaDecorations(decorationIds, decorations);
}

export function focusResultsEditor(): void {
  editor?.focus();
}
