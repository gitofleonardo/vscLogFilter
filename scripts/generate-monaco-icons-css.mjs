/**
 * Generate static codicon :before rules for Monaco widgets inside VS Code webviews.
 * Runtime-injected `.monaco-colors` styles are unreliable under webview CSP.
 */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getCodiconFontCharacters } from '../node_modules/monaco-editor/esm/vs/base/common/codiconsUtil.js';

await import('../node_modules/monaco-editor/esm/vs/base/common/codiconsLibrary.js');

const chars = getCodiconFontCharacters();

function iconRule(id, code) {
  return `.codicon-${id}:before { content: '\\${code.toString(16)}'; }\n`;
}

let css = '/* Auto-generated — do not edit. Run: node scripts/generate-monaco-icons-css.mjs */\n';

for (const [id, code] of Object.entries(chars)) {
  css += iconRule(id, code);
}

const findWidgetIcons = {
  'find-previous-match': 'arrow-up',
  'find-next-match': 'arrow-down',
  'find-selection': 'selection',
  'find-collapsed': 'chevron-right',
  'find-expanded': 'chevron-down',
  'find-replace': 'replace',
  'find-replace-all': 'replace-all',
  'widget-close': 'close',
};

for (const [id, base] of Object.entries(findWidgetIcons)) {
  const code = chars[base];
  if (code !== undefined) {
    css += iconRule(id, code);
  }
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'media');
writeFileSync(join(outDir, 'monaco-icons.css'), css);
console.log('Generated media/monaco-icons.css');
