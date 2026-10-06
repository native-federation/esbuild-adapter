import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EsBuildAdapterConfig } from '../domain/adapter-config.contract.js';
import type { NfFrameworkPlugin } from '../domain/framework-plugin.contract.js';
import { createEsBuildAdapter } from '../core/esbuild-adapter.js';
import { reactFrameworkPlugin } from '../frameworks/react.js';
import {
  createExternalsCacheKey,
  readKeyedVersions,
  type KeyedVersions,
} from './externals-cache-key.js';

const versions: KeyedVersions = {
  adapter: '@softarc/native-federation-esbuild@4.2.0',
  esbuild: '0.28.2',
};

const keyOf = (config: Partial<EsBuildAdapterConfig> = {}, v: Partial<KeyedVersions> = {}) =>
  JSON.stringify(createExternalsCacheKey({ plugins: [], ...config }, { ...versions, ...v }));

const plugin = (name: string): esbuild.Plugin => ({ name, setup: () => {} });

describe('createExternalsCacheKey', () => {
  const baseline = keyOf();

  it('is stable for identical inputs', () => {
    expect(keyOf()).toBe(baseline);
  });

  it('keys the npm bundle options per mode', () => {
    const key = createExternalsCacheKey({ plugins: [] }, versions);
    expect(key.adapter).toBe(versions.adapter);
    expect(Object.keys(key.options!)).toEqual(['esbuild', 'dev', 'prod']);
    expect(key.options!['dev']).not.toBe(key.options!['prod']);
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

  // Plugins are opaque functions; their name is all that survives serialisation.
  it('changes with the plugin names', () => {
    expect(keyOf({ plugins: [plugin('a')] })).not.toBe(baseline);
    expect(keyOf({ plugins: [plugin('a')] })).not.toBe(keyOf({ plugins: [plugin('b')] }));
    expect(keyOf({ plugins: [plugin('a')] })).toBe(keyOf({ plugins: [plugin('a')] }));
  });

  // Plugin objects may carry circular references or per-run state; only the name may reach the key.
  it('ignores everything on a plugin but its name', () => {
    const stateful = { ...plugin('a'), startedAt: Date.now(), self: undefined as unknown };
    stateful.self = stateful;
    expect(keyOf({ plugins: [stateful] })).toBe(keyOf({ plugins: [plugin('a')] }));
    expect(keyOf({ frameworks: [{ name: 'fw', esbuildPlugins: [stateful] }] })).toBe(
      keyOf({ frameworks: [{ name: 'fw', esbuildPlugins: [plugin('a')] }] })
    );
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

describe('createExternalsCacheKey with frameworks', () => {
  const react = () => keyOf({ frameworks: [reactFrameworkPlugin()] });

  it('is stable across separate preset instances', () => {
    expect(react()).toBe(react());
  });

  // The React preset swaps in CJS builds and the CommonJS plugin; dropping it must rebuild externals.
  it('changes when the React preset is removed', () => {
    expect(react()).not.toBe(keyOf({ frameworks: [] }));
  });

  it('changes when a user replacement overrides a framework replacement', () => {
    expect(
      keyOf({
        frameworks: [reactFrameworkPlugin()],
        fileReplacements: { 'node_modules/react/index.js': 'src/react-shim.js' },
      })
    ).not.toBe(react());
  });

  it('changes with needsCommonJsPlugin', () => {
    const fw = (needsCommonJsPlugin: boolean): NfFrameworkPlugin => ({
      name: 'fw',
      needsCommonJsPlugin,
    });
    expect(keyOf({ frameworks: [fw(true)] })).not.toBe(keyOf({ frameworks: [fw(false)] }));
  });

  it('changes with framework resolveExtensions and esbuildPlugins', () => {
    const base = keyOf({ frameworks: [{ name: 'fw' }] });
    expect(keyOf({ frameworks: [{ name: 'fw', resolveExtensions: ['.vue'] }] })).not.toBe(base);
    expect(keyOf({ frameworks: [{ name: 'fw', esbuildPlugins: [plugin('p')] }] })).not.toBe(base);
  });

  // The key follows the merged result, not where an option came from.
  it('treats a framework loader like the same user loader', () => {
    expect(keyOf({ frameworks: [{ name: 'fw', loader: { '.svg': 'text' } }] })).toBe(
      keyOf({ frameworks: [{ name: 'fw' }], loader: { '.svg': 'text' } })
    );
  });

  // createEsBuildAdapter applies the React default before building the key.
  it('keys an unset frameworks option like the React preset', () => {
    const adapterKey = (frameworks?: NfFrameworkPlugin[]) =>
      JSON.stringify(createEsBuildAdapter({ plugins: [], frameworks }).externalsCacheKey);
    expect(adapterKey()).toBe(adapterKey([reactFrameworkPlugin()]));
    expect(adapterKey()).not.toBe(adapterKey([]));
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
