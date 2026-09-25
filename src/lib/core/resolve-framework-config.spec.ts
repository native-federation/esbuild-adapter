import type * as esbuild from 'esbuild';
import type { NfFrameworkPlugin } from '../domain/framework-plugin.contract.js';
import { resolveFrameworkConfig } from './resolve-framework-config.js';

const plugin = (name: string): esbuild.Plugin => ({ name, setup: () => undefined });

describe('resolveFrameworkConfig', () => {
  const defaults = ['.mjs', '.js'];

  it('returns the user config unchanged when no frameworks are set', () => {
    const userPlugin = plugin('user');
    const result = resolveFrameworkConfig({ plugins: [userPlugin] }, false, defaults);

    expect(result).toEqual({
      plugins: [userPlugin],
      fileReplacements: undefined,
      loader: undefined,
      resolveExtensions: defaults,
      needsCommonJsPlugin: false,
    });
  });

  it('picks the fileReplacements matching the mode', () => {
    const fw: NfFrameworkPlugin = {
      name: 'fw',
      fileReplacements: { dev: { a: 'a.dev.js' }, prod: { a: 'a.prod.js' } },
    };

    expect(
      resolveFrameworkConfig({ plugins: [], frameworks: [fw] }, true, defaults).fileReplacements
    ).toEqual({ a: 'a.dev.js' });
    expect(
      resolveFrameworkConfig({ plugins: [], frameworks: [fw] }, false, defaults).fileReplacements
    ).toEqual({ a: 'a.prod.js' });
  });

  it('lets user fileReplacements and loader override framework values', () => {
    const fw: NfFrameworkPlugin = {
      name: 'fw',
      fileReplacements: { prod: { a: 'fw-a.js', b: 'fw-b.js' } },
      loader: { '.svg': 'file', '.png': 'file' },
    };

    const result = resolveFrameworkConfig(
      {
        plugins: [],
        frameworks: [fw],
        fileReplacements: { a: 'user-a.js' },
        loader: { '.svg': 'text' },
      },
      false,
      defaults
    );

    expect(result.fileReplacements).toEqual({ a: 'user-a.js', b: 'fw-b.js' });
    expect(result.loader).toEqual({ '.svg': 'text', '.png': 'file' });
  });

  it('appends framework extensions after the defaults without duplicates', () => {
    const result = resolveFrameworkConfig(
      {
        plugins: [],
        frameworks: [
          { name: 'a', resolveExtensions: ['.js', '.vue'] },
          { name: 'b', resolveExtensions: ['.svelte'] },
        ],
      },
      false,
      defaults
    );

    expect(result.resolveExtensions).toEqual(['.mjs', '.js', '.vue', '.svelte']);
  });

  it('runs framework plugins before user plugins', () => {
    const fwPlugin = plugin('fw');
    const userPlugin = plugin('user');

    const result = resolveFrameworkConfig(
      { plugins: [userPlugin], frameworks: [{ name: 'fw', esbuildPlugins: [fwPlugin] }] },
      false,
      defaults
    );

    expect(result.plugins).toEqual([fwPlugin, userPlugin]);
  });

  it('needs the CommonJS plugin when any framework asks for it', () => {
    const result = resolveFrameworkConfig(
      { plugins: [], frameworks: [{ name: 'a' }, { name: 'b', needsCommonJsPlugin: true }] },
      false,
      defaults
    );

    expect(result.needsCommonJsPlugin).toBe(true);
  });
});
