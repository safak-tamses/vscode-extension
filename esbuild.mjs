import { build, context } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info'
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ['src/ui/webview/config.ts', 'src/ui/webview/detail.ts'],
  outdir: 'dist/webview',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info'
};

function copyStyles() {
  mkdirSync('dist/webview', { recursive: true });
  cpSync('src/ui/webview/styles.css', 'dist/webview/styles.css');
}

if (watch) {
  const ext = await context(extensionConfig);
  const wv = await context(webviewConfig);
  await ext.watch();
  await wv.watch();
  copyStyles();
  console.log('[esbuild] watching...');
} else {
  await build(extensionConfig);
  await build(webviewConfig);
  copyStyles();
  console.log('[esbuild] build complete');
}
