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
import { writeResult } from '../utils/write-result.js';

export function createEsBuildAdapter(
  config: EsBuildAdapterConfig,
  { workspaceRoot }: EsBuildAdapterOptions = {}
): NFBuildAdapter {
  const resolved = resolveAdapterConfig(config);
  const contexts = new Map<string, CachedContext>();

  // Leaves the esbuild service running: stopping it would break every other context in the process.
  const dispose = async (name?: string): Promise<void> => {
    const names = name === undefined ? [...contexts.keys()] : [name];
    await Promise.all(
      names.map(async n => {
        const entry = contexts.get(n);
        contexts.delete(n);
        await entry?.ctx.dispose();
      })
    );
  };

  const setup = async (
    name: string,
    options: NFBuildAdapterOptions<EsbuildBundlerCache>
  ): Promise<void> => {
    // A context left over from a failed build was set up with options that may be stale.
    await dispose(name);

    // Read per setup: hosts may chdir into the project after creating the adapter.
    const workingDir = path.resolve(workspaceRoot ?? process.cwd());
    const buildOptions = options.isMappingOrExposed
      ? sourceBuildOptions(options, resolved, workingDir)
      : sharedBuildOptions(options, resolved, workingDir);

    contexts.set(name, {
      ctx: await esbuild.context(buildOptions),
      name,
      outdir: options.outdir,
      dev: !!options.dev,
      isMappingOrExposed: options.isMappingOrExposed,
      bundlerCache: options.cache?.bundlerCache,
      workingDir,
    });
  };

  const build = async (
    name: string,
    { modifiedFiles, signal }: { modifiedFiles?: string[]; signal?: AbortSignal } = {}
  ): Promise<NFBuildAdapterResult[]> => {
    const entry = contexts.get(name);
    if (!entry) {
      throw new Error(`No context found for build "${name}". Call setup() first.`);
    }
    if (signal?.aborted) {
      throw new AbortedError('[build] Aborted before rebuild');
    }

    for (const file of modifiedFiles ?? []) entry.bundlerCache?.delete(file);

    const cancel = () => void entry.ctx.cancel().catch(() => undefined);
    signal?.addEventListener('abort', cancel, { once: true });

    let result: esbuild.BuildResult;
    try {
      result = await entry.ctx.rebuild();
    } catch (error) {
      throw signal?.aborted ? new AbortedError('[build] esbuild rebuild was canceled') : error;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    if (signal?.aborted) {
      throw new AbortedError('[build] Aborted after rebuild');
    }

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
  };

  return { externalsCacheKey: createExternalsCacheKey(resolved), setup, build, dispose };
}

// Inputs from a plugin namespace ('nf-cjs-external:react') or esbuild itself ('<stdin>') aren't
// files; a Windows drive letter ('C:/...') is.
function isVirtualInput(input: string): boolean {
  return input.startsWith('<') || /^[^/\\]{2,}:/.test(input);
}
