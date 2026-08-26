const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  sourcemap: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  logLevel: 'info',
};

const extensionCtx = esbuild.context({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
});

const workerCtx = esbuild.context({
  ...common,
  entryPoints: ['src/worker/logParser.worker.ts'],
  outfile: 'dist/logParser.worker.js',
});

const webviewHighlightCtx = esbuild.context({
  bundle: true,
  sourcemap: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'LogFilterHighlights',
  entryPoints: ['media/highlightRanges-entry.ts'],
  outfile: 'media/highlightRanges.js',
  logLevel: 'info',
});

async function main() {
  const ext = await extensionCtx;
  const worker = await workerCtx;
  const webviewHighlight = await webviewHighlightCtx;
  if (watch) {
    await ext.watch();
    await worker.watch();
    await webviewHighlight.watch();
  } else {
    await ext.rebuild();
    await worker.rebuild();
    await webviewHighlight.rebuild();
    await ext.dispose();
    await worker.dispose();
    await webviewHighlight.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
