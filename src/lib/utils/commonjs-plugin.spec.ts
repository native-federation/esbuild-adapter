import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExternalMatcher, createScopedCommonJsPlugin } from './commonjs-plugin.js';

/**
 * Fake packages in a throwaway node_modules:
 *
 * - `fake-react` is plain CJS and is shared, so it's external in every build below.
 * - `fake-dom` requires `fake-react`, like react-dom does. esbuild alone turns that into a
 *   `__require("fake-react")` shim that throws in the browser.
 * - `umd-sniff` is a minimal copy of quill-delta's Delta.js: named `exports.*` plus a trailing
 *   `typeof module === 'object'` block that chialab mistakes for UMD (angular-adapter #108).
 * - `consumer` is ESM and imports a named export from `umd-sniff`, as quill does.
 * - `reexporter` is shaped like react/index.js: it only re-exports `./cjs/impl.js`.
 * - `linked-cjs` lives in `.pnpm/` and is reached through a node_modules symlink, as under pnpm.
 * - `node-cjs` requires builtins, which esbuild only externalizes implicitly on `platform: 'node'`.
 */
let ws: string;

function write(relative: string, contents: string): void {
  const file = path.join(ws, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function pkg(name: string, main: string, source: string): void {
  write(`node_modules/${name}/package.json`, JSON.stringify({ name, main }));
  write(`node_modules/${name}/${main}`, source);
}

const entry = (name: string, main = 'index.js') => path.join(ws, 'node_modules', name, main);

beforeAll(() => {
  ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-commonjs-')));

  pkg('fake-react', 'index.js', 'exports.createElement = function () { return 1; };\n');
  pkg(
    'fake-dom',
    'index.js',
    'var React = require("fake-react");\nexports.render = function () { return React.createElement(); };\n'
  );
  pkg(
    'umd-sniff',
    'index.js',
    [
      '"use strict";',
      'Object.defineProperty(exports, "__esModule", { value: true });',
      'exports.Helper = void 0;',
      'exports.Helper = 42;',
      'class Thing {}',
      'exports.default = Thing;',
      "if (typeof module === 'object') {",
      '  module.exports = Thing;',
      '  module.exports.default = Thing;',
      '}',
      '',
    ].join('\n')
  );
  pkg(
    'consumer',
    'index.mjs',
    'import Thing, { Helper } from "umd-sniff";\nexport { Thing, Helper };\n'
  );
  pkg(
    'reexporter',
    'index.js',
    '"use strict";\nif (process.env.NODE_ENV === "production") {\n  module.exports = require("./cjs/impl.js");\n} else {\n  module.exports = require("./cjs/impl.js");\n}\n'
  );
  write('node_modules/reexporter/cjs/impl.js', 'exports.useThing = function () { return 1; };\n');
  write('node_modules/.pnpm/linked-cjs/package.json', JSON.stringify({ name: 'linked-cjs' }));
  write('node_modules/.pnpm/linked-cjs/index.js', 'exports.linked = 1;\n');
  fs.symlinkSync(
    path.join(ws, 'node_modules/.pnpm/linked-cjs'),
    path.join(ws, 'node_modules/linked-cjs'),
    'dir'
  );
  pkg(
    'node-cjs',
    'index.js',
    'var fs = require("fs");\nvar path = require("node:path");\nexports.read = function () { return [fs, path]; };\n'
  );
});

afterAll(() => fs.rmSync(ws, { recursive: true, force: true }));

async function bundle(
  entryPoints: string[],
  plugins: esbuild.Plugin[],
  options: esbuild.BuildOptions = {}
): Promise<string> {
  const result = await esbuild.build({
    entryPoints,
    external: ['fake-react'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    ...options,
    write: false,
    outdir: path.join(ws, 'out'),
    logLevel: 'silent',
    plugins,
  });
  return result.outputFiles.map(file => file.text).join('\n');
}

describe('createScopedCommonJsPlugin', () => {
  it('turns a require() of an external into an import', async () => {
    const entryPoints = [entry('fake-dom')];
    const code = await bundle(entryPoints, [
      await createScopedCommonJsPlugin(entryPoints, ['fake-react']),
    ]);

    expect(code).toMatch(/import .* from "fake-react"/);
    expect(code).not.toContain('__require("fake-react")');
  });

  it('keeps the named exports of a module chialab would mistake for UMD', async () => {
    const entryPoints = [entry('consumer', 'index.mjs')];
    const code = await bundle(entryPoints, [
      await createScopedCommonJsPlugin(entryPoints, ['fake-react']),
    ]);

    expect(code).toMatch(/export \{[^}]*\bHelper\b/);
  });

  // Converting every file is what the adapter used before; this pins down why it had to change.
  it('breaks that module when it is converted', async () => {
    const { transform } = await import('@chialab/cjs-to-esm');
    const source = fs.readFileSync(entry('umd-sniff'), 'utf-8');

    expect((await transform(source, { sourcemap: false }))!.code).not.toMatch(/as "Helper"/);
  });

  // With synthesizeCjsExports off, core hands the CJS file itself over as the entry point.
  it('still gives a CJS entry point named exports', async () => {
    const entryPoints = [entry('fake-react')];
    const code = await bundle(entryPoints, [await createScopedCommonJsPlugin(entryPoints, [])]);

    expect(code).toMatch(/export \{[^}]*\bcreateElement\b/);
  });

  it('gives a CJS entry point reached through a symlink named exports', async () => {
    const entryPoints = [path.join(ws, 'node_modules/linked-cjs/index.js')];
    const code = await bundle(entryPoints, [await createScopedCommonJsPlugin(entryPoints, [])]);

    expect(code).toMatch(/export \{[^}]*\blinked\b/);
  });

  // react/index.js becomes `export * from './cjs/react.production.js'`; the re-exported file
  // has to be converted too, or esbuild's own interop leaves only a default export.
  it('gives an entry point that re-exports another CJS file its named exports', async () => {
    const entryPoints = [entry('reexporter')];
    const code = await bundle(entryPoints, [await createScopedCommonJsPlugin(entryPoints, [])]);

    expect(code).toMatch(/export \{[^}]*\buseThing\b/);
  });

  it('turns a require() of a builtin into an import on node', async () => {
    // No entry points passed, so only the builtin requires bring node-cjs into scope.
    const code = await bundle([entry('node-cjs')], [await createScopedCommonJsPlugin([], [])], {
      platform: 'node',
    });

    expect(code).toMatch(/import .* from "fs"/);
    expect(code).toMatch(/import .* from "node:path"/);
    expect(code).not.toMatch(/__require\("(node:)?(fs|path)"\)/);
  });

  it('leaves the onLoad hooks of later plugins alone', async () => {
    const entryPoints = [entry('consumer', 'index.mjs')];
    const seen: string[] = [];
    const spy: esbuild.Plugin = {
      name: 'spy',
      setup(build) {
        build.onLoad({ filter: /\.m?js$/ }, args => {
          seen.push(path.relative(ws, args.path));
          return undefined;
        });
      },
    };

    await bundle(entryPoints, [await createScopedCommonJsPlugin(entryPoints, ['fake-react']), spy]);

    expect(seen).toEqual(
      expect.arrayContaining(['node_modules/consumer/index.mjs', 'node_modules/umd-sniff/index.js'])
    );
  });
});

describe('createExternalMatcher', () => {
  const isExternal = createExternalMatcher(['react', '@scope/pkg', 'rxjs/*']);

  it.each(['react', 'react/jsx-runtime', '@scope/pkg', '@scope/pkg/sub', 'rxjs/operators'])(
    'matches %s',
    specifier => {
      expect(isExternal(specifier)).toBe(true);
    }
  );

  it.each(['react-dom', 'reactive', '@scope/other', '@scope', 'rxjs', './react'])(
    'does not match %s',
    specifier => {
      expect(isExternal(specifier)).toBe(false);
    }
  );
});
