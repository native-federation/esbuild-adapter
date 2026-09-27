import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as url from 'url';
import { createCommonJsPlugin, createExternalMatcher } from './commonjs-plugin.js';

/**
 * Fake packages in a throwaway node_modules:
 *
 * - `fake-react` is plain CJS and is shared, so it's external in every build below.
 * - `fake-dom` requires `fake-react`, like react-dom does. esbuild alone turns that into a
 *   `__require("fake-react")` shim that throws in the browser.
 * - `chain` is the shape that broke when only some files were converted: the entry requires
 *   `./a.js`, which requires none of the externals but does require `./b.js`, which requires
 *   `fake-react`.
 * - `umd-sniff` is a minimal copy of quill-delta's Delta.js: named `exports.*` plus a trailing
 *   `typeof module === 'object'` block that chialab mistook for UMD (angular-adapter #108).
 * - `consumer` is ESM and imports a named export from `umd-sniff`, as quill does.
 * - `esm-default` and `esm-mixed` are ESM externals: one only has a default export (a shared CJS
 *   package with synthesizeCjsExports off), the other has a default next to unrelated named ones.
 * - `node-cjs` requires builtins, which esbuild only externalizes implicitly on `platform: 'node'`.
 */
let ws: string;

function write(relative: string, contents: string): void {
  const file = path.join(ws, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function pkg(name: string, main: string, source: string, type?: string): void {
  write(`node_modules/${name}/package.json`, JSON.stringify({ name, main, type }));
  write(`node_modules/${name}/${main}`, source);
}

const entry = (name: string, main = 'index.js') => path.join(ws, 'node_modules', name, main);

const EXTERNAL = ['fake-react', 'esm-default', 'esm-mixed'];

beforeAll(() => {
  ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-commonjs-')));

  pkg('fake-react', 'index.js', 'exports.createElement = function () { return "element"; };\n');
  pkg(
    'fake-dom',
    'index.js',
    'var React = require("fake-react");\nexports.render = function () { return React.createElement(); };\n'
  );
  pkg(
    'chain',
    'index.js',
    'var a = require("./a.js");\nexports.run = function () { return a(); };\n'
  );
  write(
    'node_modules/chain/a.js',
    'var b = require("./b.js");\nmodule.exports = function () { return b(); };\n'
  );
  write(
    'node_modules/chain/b.js',
    'var React = require("fake-react");\nmodule.exports = function () { return React.createElement(); };\n'
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
  pkg('esm-default', 'index.js', 'export default { value: "default" };\n', 'module');
  pkg(
    'esm-mixed',
    'index.js',
    'export default { other: "default" };\nexport const other = "named";\n',
    'module'
  );
  pkg(
    'requires-esm',
    'index.js',
    'exports.fromDefault = require("esm-default").value;\nexports.mixed = require("esm-mixed");\n'
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
    external: EXTERNAL,
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

// Writes the bundle next to the fake node_modules so its external imports resolve, then runs it.
async function run(entryPoint: string): Promise<Record<string, unknown>> {
  const code = await bundle([entryPoint], [createCommonJsPlugin(EXTERNAL)]);
  const file = path.join(ws, `out-${path.basename(path.dirname(entryPoint))}.mjs`);
  fs.writeFileSync(file, code);
  return import(/* @vite-ignore */ url.pathToFileURL(file).href);
}

describe('createCommonJsPlugin', () => {
  it('turns a require() of an external into an import', async () => {
    const code = await bundle([entry('fake-dom')], [createCommonJsPlugin(EXTERNAL)]);

    expect(code).toMatch(/import \* as \w+ from "fake-react"/);
    expect(code).not.toContain('__require("fake-react")');
  });

  it('hands a CJS caller the module.exports of a CJS external', async () => {
    const mod = await run(entry('fake-dom'));

    expect((mod['default'] as { render(): string }).render()).toBe('element');
  });

  it('keeps plain CJS requires working between files of a package', async () => {
    const mod = await run(entry('chain'));

    expect((mod['default'] as { run(): string }).run()).toBe('element');
  });

  it('unwraps the default of an ES module external only when it is all there is', async () => {
    const mod = (await run(entry('requires-esm')))['default'] as Record<string, unknown>;

    expect(mod['fromDefault']).toBe('default');
    // A module namespace object, which toMatchObject can't walk.
    expect({ ...(mod['mixed'] as object) }).toEqual({
      default: { other: 'default' },
      other: 'named',
    });
  });

  it('keeps the named exports of a module chialab would mistake for UMD', async () => {
    const code = await bundle([entry('consumer', 'index.mjs')], [createCommonJsPlugin(EXTERNAL)]);

    expect(code).toMatch(/export \{[^}]*\bHelper\b/);
  });

  it('turns a require() of a builtin into an import on node', async () => {
    const code = await bundle([entry('node-cjs')], [createCommonJsPlugin([])], {
      platform: 'node',
    });

    expect(code).toMatch(/import \* as \w+ from "fs"/);
    expect(code).toMatch(/import \* as \w+ from "node:path"/);
    expect(code).not.toMatch(/__require\("(node:)?(fs|path)"\)/);
  });

  it('leaves requires alone when the output is not ESM', async () => {
    const code = await bundle([entry('fake-dom')], [createCommonJsPlugin(EXTERNAL)], {
      format: 'cjs',
    });

    expect(code).toContain('require("fake-react")');
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
