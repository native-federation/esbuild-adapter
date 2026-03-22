import type {
  NFBuildAdapter,
  NFBuildAdapterContext,
  NFBuildAdapterOptions,
  NFBuildAdapterResult,
} from '@softarc/native-federation/domain';
import { AbortedError } from '@softarc/native-federation/internal';
import * as esbuild from 'esbuild';
import type { EsBuildAdapterConfig } from '../domain/adapter-config.contract.js';
import { writeResult } from '../utils/write-result.js';
import { createSourceCodeEsbuildContext } from '../utils/source-code-bundler.js';
import { createNodeModulesEsbuildContext } from '../utils/node-modules-bundler.js';

export function createEsBuildAdapter(config: EsBuildAdapterConfig): NFBuildAdapter {
  if (!config.compensateExports) {
    config.compensateExports = [new RegExp('/react/')];
  }

  const bundleContextCache = new Map<string, NFBuildAdapterContext<esbuild.BuildContext>>();

  const dispose = async (name?: string): Promise<void> => {
    if (name) {
      if (!bundleContextCache.has(name)) {
        throw new Error(`Could not dispose of non-existing build '${name}'`);
      }
      const entry = bundleContextCache.get(name)!;
      await entry.ctx.dispose();
      bundleContextCache.delete(name);
      return;
    }

    // Dispose all contexts
    const disposals: Promise<void>[] = [];

    for (const [, entry] of bundleContextCache) {
      disposals.push(entry.ctx.dispose());
    }
    bundleContextCache.clear();
    await Promise.all(disposals);

    await esbuild.stop();
  };

  const setup = async (name: string, options: NFBuildAdapterOptions): Promise<void> => {
    const {
      entryPoints,
      external,
      outdir,
      hash,
      dev = false,
      platform = 'browser',
      tsConfigPath,
      isMappingOrExposed,
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
    });
  };

  const build = async (
    name: string,
    opts: { files?: string[]; signal?: AbortSignal } = {}
  ): Promise<NFBuildAdapterResult[]> => {
    const bundleContext = bundleContextCache.get(name);
    if (!bundleContext) {
      throw new Error(`No context found for build "${name}". Call setup() first.`);
    }

    if (opts?.signal?.aborted) {
      throw new AbortedError('[build] Aborted before rebuild');
    }

    try {
      const result = await bundleContext.ctx.rebuild();
      const writtenFiles = writeResult(result, bundleContext.outdir);

      return writtenFiles.map(fileName => ({ fileName }));
    } catch (error) {
      if (opts?.signal?.aborted && error instanceof Error && error.message.includes('canceled')) {
        throw new AbortedError('[build] ESBuild rebuild was canceled.');
      }
      throw error;
    }
  };

  return { setup, build, dispose };
}
