import type * as esbuild from 'esbuild';
import type { EsBuildAdapterConfig } from '../domain/adapter-config.contract.js';
import type { NfFrameworkPlugin } from '../domain/framework-plugin.contract.js';
import { resolveAdapterConfig } from './resolve-config.js';

const plugin = (name: string): esbuild.Plugin => ({ name, setup: () => undefined });

describe('resolveAdapterConfig', () => {
  it('returns the user config unchanged when no frameworks are set', () => {
    const userPlugin = plugin('user');
    const result = resolveAdapterConfig({ plugins: [userPlugin] });

    expect(result).toEqual({
      plugins: [userPlugin],
      loader: undefined,
      resolveExtensions: [],
      fileReplacements: { dev: {}, prod: {} },
      define: undefined,
      target: undefined,
      sourcemap: undefined,
      preserveSymlinks: undefined,
    });
  });

  it('does not modify the config it is given', () => {
    const config: EsBuildAdapterConfig = { plugins: [], loader: { '.svg': 'text' } };
    const before = structuredClone(config);
    resolveAdapterConfig({ ...config, frameworks: [{ name: 'fw', loader: { '.png': 'file' } }] });
    resolveAdapterConfig(config);

    expect(config).toEqual(before);
  });

  it('picks the framework fileReplacements per mode and normalizes them to file paths', () => {
    const fw: NfFrameworkPlugin = {
      name: 'fw',
      fileReplacements: { dev: { a: 'a.dev.js' }, prod: { a: { file: 'a.prod.js' } } },
    };

    expect(resolveAdapterConfig({ plugins: [], frameworks: [fw] }).fileReplacements).toEqual({
      dev: { a: 'a.dev.js' },
      prod: { a: 'a.prod.js' },
    });
  });

  it('lets user fileReplacements and loader override framework values in both modes', () => {
    const fw: NfFrameworkPlugin = {
      name: 'fw',
      fileReplacements: { prod: { a: 'fw-a.js', b: 'fw-b.js' } },
      loader: { '.svg': 'file', '.png': 'file' },
    };

    const result = resolveAdapterConfig({
      plugins: [],
      frameworks: [fw],
      fileReplacements: { a: 'user-a.js' },
      loader: { '.svg': 'text' },
    });

    expect(result.fileReplacements).toEqual({
      dev: { a: 'user-a.js' },
      prod: { a: 'user-a.js', b: 'fw-b.js' },
    });
    expect(result.loader).toEqual({ '.svg': 'text', '.png': 'file' });
  });

  // replaceSuffix lets the last matching key win, so an overridden key must move behind the
  // framework keys defined after it.
  it('orders a redefined replacement key after the keys it overrides', () => {
    const first: NfFrameworkPlugin = {
      name: 'first',
      fileReplacements: { prod: { a: 'first-a.js' } },
    };
    const second: NfFrameworkPlugin = {
      name: 'second',
      fileReplacements: { prod: { b: 'second-b.js' } },
    };

    const result = resolveAdapterConfig({
      plugins: [],
      frameworks: [first, second],
      fileReplacements: { a: 'user-a.js' },
    });

    expect(Object.keys(result.fileReplacements.prod)).toEqual(['b', 'a']);
    expect(result.fileReplacements.prod.a).toBe('user-a.js');
  });

  it('collects the framework extensions', () => {
    const result = resolveAdapterConfig({
      plugins: [],
      frameworks: [
        { name: 'a', resolveExtensions: ['.vue'] },
        { name: 'b', resolveExtensions: ['.svelte'] },
      ],
    });

    expect(result.resolveExtensions).toEqual(['.vue', '.svelte']);
  });

  it('runs framework plugins before user plugins', () => {
    const fwPlugin = plugin('fw');
    const userPlugin = plugin('user');

    const result = resolveAdapterConfig({
      plugins: [userPlugin],
      frameworks: [{ name: 'fw', esbuildPlugins: [fwPlugin] }],
    });

    expect(result.plugins).toEqual([fwPlugin, userPlugin]);
  });

  it('passes define, target, sourcemap and preserveSymlinks through from the user config', () => {
    const result = resolveAdapterConfig({
      plugins: [],
      define: { BUILD_ID: '"42"' },
      target: 'es2020',
      sourcemap: 'external',
      preserveSymlinks: true,
    });

    expect(result).toMatchObject({
      define: { BUILD_ID: '"42"' },
      target: 'es2020',
      sourcemap: 'external',
      preserveSymlinks: true,
    });
  });
});
