import type {
  NFBuildAdapter,
  NFBuildAdapterOptions,
  NFBuildAdapterResult,
} from '@softarc/native-federation/domain';
import { AbortedError } from '@softarc/native-federation/internal';
import * as esbuild from 'esbuild';
import type { EsBuildAdapterConfig } from '../domain/adapter-config.contract.js';
import type { CachedContext, EsbuildBundlerCache } from '../domain/adapter-context.contract.js';
import { writeResult } from '../utils/write-result.js';
import { createSourceCodeEsbuildContext } from '../utils/source-code-bundler.js';
import { createNodeModulesEsbuildContext } from '../utils/node-modules-bundler.js';

export function createEsBuildAdapter(config: EsBuildAdapterConfig): NFBuildAdapter {
  if (!config.compensateExports) {
    config.compensateExports = [new RegExp('/react/')];
  }

  const bundleContextCache = new Map<string, CachedContext>();

  const dispose = async (name?: string): Promise<void> => {
    if (name) {
      const entry = bundleContextCache.get(name);
      if (!entry) {
        throw new Error(`Could not dispose of non-existing build '${name}'`);
      }
      await entry.ctx.dispose();
      bundleContextCache.delete(name);
      return;
    }

    const disposals: Promise<void>[] = [];
    for (const [, entry] of bundleContextCache) {
      disposals.push(entry.ctx.dispose());
    }
    bundleContextCache.clear();
    await Promise.all(disposals);

    await esbuild.stop();
  };

  const setup = async (
    name: string,
    options: NFBuildAdapterOptions<EsbuildBundlerCache>
  ): Promise<void> => {
    const {
      entryPoints,
      external,
      outdir,
      hash,
      dev = false,
      platform = 'browser',
      tsConfigPath,
      isMappingOrExposed,
      cache,
    } = options;

    if (bundleContextCache.has(name)) {
      return;
    }

    const esbuildPlatform = platform === 'node' ? 'node' : 'browser';

    const ctx = isMappingOrExposed
      ? await createSourceCodeEsbuildContext(
          entryPoints,
          external,
          outdir,
          config,
          dev,
          hash,
          esbuildPlatform,
          tsConfigPath
        )
      : await createNodeModulesEsbuildContext(
          entryPoints,
          external,
          outdir,
          config,
          dev,
          hash,
          esbuildPlatform
        );

    bundleContextCache.set(name, {
      ctx,
      outdir,
      dev,
      name,
      isMappingOrExposed,
      bundlerCache: cache?.bundlerCache,
    });
  };

  const build = async (
    name: string,
    opts: { modifiedFiles?: string[]; signal?: AbortSignal } = {}
  ): Promise<NFBuildAdapterResult[]> => {
    const entry = bundleContextCache.get(name);
    if (!entry) {
      throw new Error(`No context found for build "${name}". Call setup() first.`);
    }

    if (opts.signal?.aborted) {
      throw new AbortedError('[build] Aborted before rebuild');
    }

    if (opts.modifiedFiles && entry.bundlerCache) {
      for (const file of opts.modifiedFiles) entry.bundlerCache.delete(file);
    }

    const cancelBuild = () => {
      try {
        entry.ctx.cancel();
      } catch {
        // noop — context may already be cancelled/disposed
      }
    };
    opts.signal?.addEventListener('abort', cancelBuild, { once: true });

    try {
      const result = await entry.ctx.rebuild();
      const writtenFiles = writeResult(result, entry.outdir);

      if (entry.bundlerCache && result.metafile) {
        for (const input of Object.keys(result.metafile.inputs)) {
          entry.bundlerCache.set(input, null);
        }
      }

      return writtenFiles.map(fileName => ({ fileName }));
    } catch (error) {
      if (opts.signal?.aborted && error instanceof Error && error.message.includes('canceled')) {
        throw new AbortedError('[build] ESBuild rebuild was canceled.');
      }
      throw error;
    } finally {
      opts.signal?.removeEventListener('abort', cancelBuild);
    }
  };

  return { setup, build, dispose };
}
