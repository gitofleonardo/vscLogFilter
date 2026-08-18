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

async function main() {
  const ext = await extensionCtx;
  const worker = await workerCtx;
  if (watch) {
    await ext.watch();
    await worker.watch();
  } else {
    await ext.rebuild();
    await worker.rebuild();
    await ext.dispose();
    await worker.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
