import type {
  EntryPoint,
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
import type { EsbuildBundlerCache } from '../domain/adapter-context.contract.js';
import { sharedBuildOptions, sourceBuildOptions } from '../esbuild/build-options.js';
import { createExternalsCacheKey } from '../esbuild/externals-cache-key.js';
import { entriesByOutputName } from '../esbuild/output-entries.js';
import { resolveAdapterConfig } from '../esbuild/resolve-config.js';
import { writeResult } from '../utils/write-result.js';

interface CachedContext {
  ctx: esbuild.BuildContext;
  entryPoints: EntryPoint[];
  outdir: string;
  bundlerCache: EsbuildBundlerCache | undefined;
  workingDir: string;
}

export function createEsBuildAdapter(
  config: EsBuildAdapterConfig,
  { workspaceRoot }: EsBuildAdapterOptions = {}
): NFBuildAdapter {
  const resolved = resolveAdapterConfig(config);
  const contexts = new Map<string, CachedContext>();
  let generation = 0;

  // Leaves the esbuild service running: stopping it would break every other context in the process.
  const dispose = async (name?: string): Promise<void> => {
    if (name === undefined) generation++;
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
    const startedIn = generation;
    // A context left over from a failed build was set up with options that may be stale.
    await dispose(name);

    // Read per setup: hosts may chdir into the project after creating the adapter.
    const workingDir = path.resolve(workspaceRoot ?? process.cwd());
    const buildOptionsFor = options.kind === 'shared' ? sharedBuildOptions : sourceBuildOptions;
    const { options: buildOptions, entryPoints } = buildOptionsFor(options, resolved, workingDir);

    const ctx = await esbuild.context(buildOptions);
    // A host may dispose() while setup is in flight; a context created after that would never be
    // disposed and keep the process alive.
    if (generation !== startedIn) {
      await ctx.dispose();
      throw new AbortedError('[setup] Adapter disposed during setup');
    }

    contexts.set(name, {
      ctx,
      entryPoints,
      outdir: options.outdir,
      // Shared inputs live in node_modules, which the watcher ignores.
      bundlerCache: options.kind === 'shared' ? undefined : options.cache.bundlerCache,
      workingDir,
    });
  };

  const build = async (
    name: string,
    { modifiedFiles, signal }: { modifiedFiles?: string[]; signal?: AbortSignal } = {}
  ): Promise<NFBuildAdapterResult[]> => {
    const bundle = contexts.get(name);
    if (!bundle) {
      throw new Error(`No context found for build "${name}". Call setup() first.`);
    }
    if (signal?.aborted) {
      throw new AbortedError('[build] Aborted before rebuild');
    }

    for (const file of modifiedFiles ?? []) bundle.bundlerCache?.delete(file);

    const cancel = () => void bundle.ctx.cancel().catch(() => undefined);
    signal?.addEventListener('abort', cancel, { once: true });

    let result: esbuild.BuildResult;
    try {
      result = await bundle.ctx.rebuild();
    } catch (error) {
      throw signal?.aborted ? new AbortedError('[build] esbuild rebuild was canceled') : error;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    if (signal?.aborted) {
      throw new AbortedError('[build] Aborted after rebuild');
    }

    // Without `entry`, core matches hashed entries by file name (core#193).
    const entryByOutputName = entriesByOutputName(
      result.metafile,
      bundle.entryPoints,
      bundle.workingDir
    );
    const written = writeResult(result, bundle.outdir, entryByOutputName);

    if (bundle.bundlerCache && result.metafile) {
      // Metafile paths are relative to absWorkingDir; the keys must be absolute posix paths to
      // match the changes the watcher reports.
      for (const input of Object.keys(result.metafile.inputs)) {
        if (isVirtualInput(input)) continue;
        const file = path.resolve(bundle.workingDir, input).split(path.sep).join('/');
        bundle.bundlerCache.set(file, null);
      }
    }

    return written;
  };

  return { externalsCacheKey: createExternalsCacheKey(resolved), setup, build, dispose };
}

// Inputs from a plugin namespace ('nf-cjs-external:react') or esbuild itself ('<stdin>') aren't
// files; a Windows drive letter ('C:/...') is.
function isVirtualInput(input: string): boolean {
  return input.startsWith('<') || /^[^/\\]{2,}:/.test(input);
}
