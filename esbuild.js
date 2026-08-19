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

const webviewCommon = {
  bundle: true,
  sourcemap: true,
  platform: 'browser',
  format: 'iife',
  logLevel: 'info',
  loader: {
    '.css': 'css',
    '.ttf': 'dataurl',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.svg': 'dataurl',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
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

const webviewCtx = esbuild.context({
  ...webviewCommon,
  entryPoints: ['src/webview/main.ts'],
  outfile: 'media/main.js',
});

const monacoWorkerCtx = esbuild.context({
  ...webviewCommon,
  entryPoints: ['src/webview/editor.worker.ts'],
  outfile: 'media/editor.worker.js',
});

async function main() {
  const ext = await extensionCtx;
  const worker = await workerCtx;
  const webview = await webviewCtx;
  const monacoWorker = await monacoWorkerCtx;
  if (watch) {
    await ext.watch();
    await worker.watch();
    await webview.watch();
    await monacoWorker.watch();
    require('child_process').execSync('node scripts/generate-monaco-icons-css.mjs', {
      cwd: __dirname,
      stdio: 'inherit',
    });
  } else {
    await ext.rebuild();
    await worker.rebuild();
    await webview.rebuild();
    await monacoWorker.rebuild();
    require('child_process').execSync('node scripts/generate-monaco-icons-css.mjs', {
      cwd: __dirname,
      stdio: 'inherit',
    });
    await ext.dispose();
    await worker.dispose();
    await webview.dispose();
    await monacoWorker.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
