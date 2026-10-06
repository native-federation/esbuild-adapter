import type * as esbuildTypes from 'esbuild';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveFrameworkConfig } from '../core/resolve-framework-config.js';
import { reactFrameworkPlugin } from '../frameworks/react.js';
import {
  createNodeModulesEsbuildContext,
  nodeModulesBuildOptions,
  NODE_MODULES_RESOLVE_EXTENSIONS,
} from './node-modules-bundler.js';

vi.mock('esbuild', async importOriginal => ({
  ...(await importOriginal<typeof esbuildTypes>()),
  context: vi.fn(async () => ({}) as esbuildTypes.BuildContext),
}));

const esbuild = await import('esbuild');

// Options core hands to the adapter per build; core keys these itself, so they stay out of
// nodeModulesBuildOptions and therefore out of the externals cache key.
const CORE_PROVIDED = ['entryPoints', 'outdir', 'entryNames', 'external', 'splitting', 'platform'];

describe('createNodeModulesEsbuildContext', () => {
  beforeEach(() => vi.mocked(esbuild.context).mockClear());

  // Guard for the externals cache key: an option added inline to esbuild.context instead of to
  // nodeModulesBuildOptions would silently escape the key and serve stale externals.
  it.each([true, false])('passes only keyed or core-provided options (dev=%s)', async dev => {
    const config = resolveFrameworkConfig(
      { plugins: [], frameworks: [reactFrameworkPlugin()], target: 'es2022' },
      dev,
      NODE_MODULES_RESOLVE_EXTENSIONS
    );
    const { fileReplacements, needsCommonJsPlugin, plugins, ...keyed } = nodeModulesBuildOptions(
      config,
      dev
    );
    expect(Object.keys(fileReplacements).length).toBeGreaterThan(0);
    expect(needsCommonJsPlugin).toBe(true);

    await createNodeModulesEsbuildContext(
      [{ fileName: 'node_modules/react/index.js', outName: 'react.js' }],
      ['react-dom'],
      'dist',
      config,
      dev,
      false,
      false,
      'browser'
    );

    const passed = vi.mocked(esbuild.context).mock.calls[0]![0];
    const { plugins: passedPlugins, ...rest } = passed;
    for (const key of CORE_PROVIDED) delete (rest as Record<string, unknown>)[key];

    expect(rest).toEqual(keyed);
    expect(passedPlugins!.slice(1)).toEqual(plugins);
  });

  it('applies the file replacements to the entry points', async () => {
    const config = resolveFrameworkConfig(
      { plugins: [], fileReplacements: { 'node_modules/foo/index.js': 'src/foo-shim.js' } },
      false,
      NODE_MODULES_RESOLVE_EXTENSIONS
    );
    const entryPoint = { fileName: 'node_modules/foo/index.js', outName: 'foo.js' };

    await createNodeModulesEsbuildContext(
      [entryPoint],
      [],
      'dist',
      config,
      false,
      false,
      false,
      'browser'
    );

    expect(entryPoint.fileName).toBe('src/foo-shim.js');
  });
});
