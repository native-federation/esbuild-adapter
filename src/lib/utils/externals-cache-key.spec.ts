import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EsBuildAdapterConfig } from '../domain/adapter-config.contract.js';
import {
  createExternalsCacheKey,
  readKeyedVersions,
  type KeyedVersions,
} from './externals-cache-key.js';

const versions: KeyedVersions = {
  adapter: '@softarc/native-federation-esbuild@4.2.0',
  esbuild: '0.28.2',
};

type KeyedConfig = Pick<
  EsBuildAdapterConfig,
  'target' | 'sourcemap' | 'fileReplacements' | 'loader'
>;

const keyOf = (config: KeyedConfig = {}, v: Partial<KeyedVersions> = {}) =>
  JSON.stringify(createExternalsCacheKey(config, { ...versions, ...v }));

describe('createExternalsCacheKey', () => {
  const baseline = keyOf();

  it('is stable for identical inputs', () => {
    expect(keyOf()).toBe(baseline);
  });

  it('leaves out unset options', () => {
    expect(createExternalsCacheKey({}, versions)).toEqual({
      adapter: versions.adapter,
      options: { esbuild: versions.esbuild },
    });
  });

  it('changes with the adapter version', () => {
    expect(keyOf({}, { adapter: '@softarc/native-federation-esbuild@4.2.1' })).not.toBe(baseline);
  });

  it('changes with the esbuild version', () => {
    expect(keyOf({}, { esbuild: '0.28.3' })).not.toBe(baseline);
  });

  it('changes with the target', () => {
    expect(keyOf({ target: 'es2022' })).not.toBe(baseline);
    expect(keyOf({ target: 'es2022' })).not.toBe(keyOf({ target: 'es2020' }));
    expect(keyOf({ target: ['chrome120', 'firefox120'] })).not.toBe(
      keyOf({ target: ['chrome120'] })
    );
  });

  // esbuild doesn't care about the order of targets, so neither should the cache.
  it('ignores the order of the target list', () => {
    expect(keyOf({ target: ['firefox120', 'chrome120'] })).toBe(
      keyOf({ target: ['chrome120', 'firefox120'] })
    );
  });

  it('treats a single target like a one-element list', () => {
    expect(keyOf({ target: 'es2022' })).toBe(keyOf({ target: ['es2022'] }));
  });

  it('changes with the sourcemap option', () => {
    expect(keyOf({ sourcemap: true })).not.toBe(baseline);
    expect(keyOf({ sourcemap: false })).not.toBe(baseline);
    expect(keyOf({ sourcemap: 'external' })).not.toBe(keyOf({ sourcemap: true }));
  });

  // fileReplacements can rewrite a shared package's entry point, so it must invalidate externals.
  it('changes with the file replacements', () => {
    expect(
      keyOf({ fileReplacements: { 'node_modules/foo/index.js': 'src/foo-shim.js' } })
    ).not.toBe(baseline);
    expect(keyOf({ fileReplacements: { 'node_modules/foo/index.js': 'src/a.js' } })).not.toBe(
      keyOf({ fileReplacements: { 'node_modules/foo/index.js': 'src/b.js' } })
    );
  });

  it('treats string and { file } replacements alike', () => {
    expect(keyOf({ fileReplacements: { 'a.js': 'b.js' } })).toBe(
      keyOf({ fileReplacements: { 'a.js': { file: 'b.js' } } })
    );
  });

  it('ignores the order of file replacements', () => {
    expect(keyOf({ fileReplacements: { 'a.js': 'x.js', 'b.js': 'y.js' } })).toBe(
      keyOf({ fileReplacements: { 'b.js': 'y.js', 'a.js': 'x.js' } })
    );
  });

  it('changes with the loader', () => {
    expect(keyOf({ loader: { '.svg': 'dataurl' } })).not.toBe(baseline);
    expect(keyOf({ loader: { '.svg': 'dataurl' } })).not.toBe(
      keyOf({ loader: { '.svg': 'text' } })
    );
  });

  it('ignores the order of loader entries', () => {
    expect(keyOf({ loader: { '.svg': 'text', '.png': 'file' } })).toBe(
      keyOf({ loader: { '.png': 'file', '.svg': 'text' } })
    );
  });

  it('treats empty fileReplacements and loader as unset', () => {
    expect(keyOf({ fileReplacements: {}, loader: {} })).toBe(baseline);
  });

  // These only reach source-code bundles, so they must not invalidate shared externals.
  it('ignores define and preserveSymlinks', () => {
    const config: EsBuildAdapterConfig = {
      plugins: [],
      define: { FOO: '"bar"' },
      preserveSymlinks: true,
    };
    expect(keyOf(config)).toBe(baseline);
  });
});

describe('readKeyedVersions', () => {
  it('reads the adapter name and version from our own package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(readKeyedVersions()).toEqual({
      adapter: `${pkg.name}@${pkg.version}`,
      esbuild: esbuild.version,
    });
  });
});
