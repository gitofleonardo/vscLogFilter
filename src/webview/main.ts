import 'monaco-editor/esm/vs/base/browser/ui/codicons/codiconStyles.js';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js';
import { initQueryUi, type PanelUpdateMessage } from './queryUi';
import { initResultsEditor, setResultsContent } from './resultsEditor';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): Record<string, unknown> | undefined;
  setState(state: Record<string, unknown>): void;
};

const vscode = acquireVsCodeApi();

const queryEl = document.getElementById('query') as HTMLInputElement;
const queryHighlightEl = document.getElementById('query-highlight') as HTMLElement;
const suggestionsEl = document.getElementById('suggestions') as HTMLElement;
const statsEl = document.getElementById('stats') as HTMLElement;
const emptyStateEl = document.getElementById('empty-state') as HTMLElement;
const editorWrapEl = document.getElementById('editor-wrap') as HTMLElement;
const editorContainerEl = document.getElementById('editor-container') as HTMLElement;
const filenameEl = document.getElementById('filename') as HTMLElement;
const warningsEl = document.getElementById('warnings') as HTMLElement;
const progressEl = document.getElementById('progress') as HTMLElement;
const progressFillEl = document.getElementById('progress-fill') as HTMLElement;
const progressTextEl = document.getElementById('progress-text') as HTMLElement;

let lastFilteredKey = '';

const queryUi = initQueryUi(
  vscode,
  {
    queryEl,
    queryHighlightEl,
    suggestionsEl,
    statsEl,
    emptyStateEl,
    editorContainerEl,
    progressEl,
    progressFillEl,
    progressTextEl,
    filenameEl,
    warningsEl,
  },
  {
    onQueryChange: (query) => {
      vscode.postMessage({ type: 'queryChange', query });
    },
  },
);

initResultsEditor(editorContainerEl, (line) => {
  vscode.postMessage({ type: 'goToSource', line });
});

function handleUpdate(msg: PanelUpdateMessage): void {
  queryUi.applyPanelUpdate(msg);

  const filteredKey = `${msg.query ?? ''}|${(msg as { filteredIds?: number[] }).filteredIds?.length ?? 0}|${(msg as { filteredIds?: number[] }).filteredIds?.[0] ?? ''}|${(msg as { filteredIds?: number[] }).filteredIds?.at(-1) ?? ''}`;
  const filterChanged = filteredKey !== lastFilteredKey;
  if (filterChanged) {
    lastFilteredKey = filteredKey;
  }

  const parsing = msg.parseState === 'parsing';
  const queryEmpty = !(msg.query ?? queryEl.value).trim();

  if (queryEmpty && !parsing) {
    setResultsContent(undefined, [], '');
    return;
  }

  if (parsing) {
    setResultsContent(undefined, [], 'Scanning log file…');
    return;
  }

  const rows = msg.rows;
  if (!rows || rows.length === 0) {
    setResultsContent(undefined, [], 'No matching log lines');
    return;
  }

  setResultsContent(rows, msg.highlightTerms ?? [], '');
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'update') {
    handleUpdate(msg as PanelUpdateMessage);
  }
});
