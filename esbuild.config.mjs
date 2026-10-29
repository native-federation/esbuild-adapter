import { rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { glob } from 'tinyglobby';

// Raw esbuild build for @softarc/native-federation-esbuild.
//
// Each source file is transpiled 1:1 (bundle: false) so the published module
// graph mirrors the source layout and keeps its explicit `./*.js` import
// specifiers intact. Type declarations are emitted separately by
// `tsc -p tsconfig.build.json` (esbuild does not generate `.d.ts`).
// Otherwise files of deleted modules stay in dist and get published.
await rm('dist', { recursive: true, force: true });

const entryPoints = await glob('src/**/*.ts', {
  ignore: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/**/__test-helpers__/**'],
});

await build({
  entryPoints,
  outdir: 'dist',
  outbase: 'src',
  bundle: false,
  format: 'esm',
  platform: 'node',
  target: 'esnext',
  logLevel: 'info',
});
