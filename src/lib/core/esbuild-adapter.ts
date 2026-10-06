import type {
  NFBuildAdapter,
  NFBuildAdapterOptions,
  NFBuildAdapterResult,
} from '@softarc/native-federation/domain';
import { AbortedError } from '@softarc/native-federation/internal';
import * as esbuild from 'esbuild';
import * as path from 'path';
import type {
  EsBuildAdapterConfig,
  EsBuildAdapterOptions,
} from '../domain/adapter-config.contract.js';
import type { CachedContext, EsbuildBundlerCache } from '../domain/adapter-context.contract.js';
import { sharedBuildOptions, sourceBuildOptions } from '../esbuild/build-options.js';
import { createExternalsCacheKey } from '../esbuild/externals-cache-key.js';
import { resolveAdapterConfig } from '../esbuild/resolve-config.js';
import { reactFrameworkPlugin } from '../frameworks/react.js';
import { writeResult } from '../utils/write-result.js';

export function createEsBuildAdapter(
  config: EsBuildAdapterConfig,
  { workspaceRoot }: EsBuildAdapterOptions = {}
): NFBuildAdapter {
  const resolved = resolveAdapterConfig({
    ...config,
    frameworks: config.frameworks ?? [reactFrameworkPlugin()],
  });
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
    if (bundleContextCache.has(name)) {
      return;
    }

    // Read per setup: hosts may chdir into the project after creating the adapter.
    const workingDir = path.resolve(workspaceRoot ?? process.cwd());
    const ctx = await esbuild.context(
      options.isMappingOrExposed
        ? sourceBuildOptions(options, resolved, workingDir)
        : sharedBuildOptions(options, resolved, workingDir)
    );

    bundleContextCache.set(name, {
      ctx,
      outdir: options.outdir,
      dev: !!options.dev,
      name,
      isMappingOrExposed: options.isMappingOrExposed,
      bundlerCache: options.cache?.bundlerCache,
      workingDir,
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
        // Metafile paths are relative to absWorkingDir; the keys must be absolute posix paths to
        // match the changes the watcher reports.
        for (const input of Object.keys(result.metafile.inputs)) {
          if (isVirtualInput(input)) continue;
          const file = path.resolve(entry.workingDir, input).split(path.sep).join('/');
          entry.bundlerCache.set(file, null);
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

  return { externalsCacheKey: createExternalsCacheKey(resolved), setup, build, dispose };
}

// Inputs from a plugin namespace ('nf-cjs-external:react') or esbuild itself ('<stdin>') aren't
// files; a Windows drive letter ('C:/...') is.
function isVirtualInput(input: string): boolean {
  return input.startsWith('<') || /^[^/\\]{2,}:/.test(input);
}
