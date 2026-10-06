import {
  buildForFederation,
  createFederationCache,
  type FederationInfo,
  getExternals,
  normalizeFederationOptions,
  rebuildForFederation,
  setBuildAdapter,
} from '@softarc/native-federation';
import {
  AbortedError,
  createNfWatcher,
  linkedSharedDirs,
  logger,
  RebuildQueue,
  setLogLevel,
  sharedMappingDirs,
  syncNfFileWatcher,
  type NfFileWatcher,
} from '@softarc/native-federation/internal';

import type {
  EsBuildBuilderOptions,
  NormalizedEsBuildBuilderOptions,
} from '../domain/builder-config.contract.js';
import type { EsbuildBundlerCache } from '../domain/adapter-context.contract.js';
import { createEsBuildAdapter } from './esbuild-adapter.js';
import { normalizeBuilderOptions } from './normalize-options.js';
import { createChangeFilter, mappingWatchDirs } from '../utils/watch-filter.js';

export interface EsBuildBuilder {
  federationInfo: FederationInfo;
  externals: string[];
  options: NormalizedEsBuildBuilderOptions;
  close(): Promise<void>;
}

export async function runEsBuildBuilder(
  federationConfigPath: string,
  rawOptions: EsBuildBuilderOptions
): Promise<EsBuildBuilder> {
  const options = normalizeBuilderOptions(rawOptions);
  setLogLevel(options.verbose ? 'verbose' : 'info');

  const adapter = createEsBuildAdapter(options.adapterConfig, {
    workspaceRoot: options.workspaceRoot,
  });
  setBuildAdapter(adapter);

  const bundlerCache: EsbuildBundlerCache = new Map<string, unknown>();

  const normalized = await normalizeFederationOptions(
    {
      projectName: options.projectName,
      workspaceRoot: options.workspaceRoot,
      outputPath: options.outputPath,
      federationConfig: federationConfigPath,
      tsConfig: options.tsConfig,
      verbose: options.verbose,
      watch: options.watch,
      watchLinkedDeps: options.watchLinkedDeps,
      dev: options.dev,
      entryPoints: options.entryPoints,
      packageJson: options.packageJson,
      cacheExternalArtifacts: options.cacheExternalArtifacts,
    },
    createFederationCache(options.cachePath, bundlerCache)
  );

  const externals = getExternals(normalized.config);

  let federationInfo: FederationInfo;
  try {
    federationInfo = await buildForFederation(normalized.config, normalized.options, externals);
  } catch (error) {
    logger.error((error as Error)?.message ?? 'Building the federation artifacts failed');
    await adapter.dispose();
    throw error;
  }

  if (!options.watch) {
    return {
      federationInfo,
      externals,
      options,
      close: () => adapter.dispose(),
    };
  }

  const linkedDirs = linkedSharedDirs(normalized.config, normalized.options);
  const isIgnored = createChangeFilter({
    workspaceRoot: normalized.options.workspaceRoot,
    outputPath: normalized.options.outputPath,
    cachePath: options.cachePath,
  });

  const rebuildQueue = new RebuildQueue();
  const pendingChanges = new Set<string>();
  let lastRebuild: Promise<unknown> = Promise.resolve();
  let closing: Promise<void> | undefined;
  let closed = false;

  const watcher: NfFileWatcher = createNfWatcher({
    watch: options.watcher,
    onChange: changedPath => {
      if (closed || isIgnored(changedPath)) return;
      pendingChanges.add(changedPath);
      lastRebuild = rebuildQueue.track(rebuild);
    },
  });

  // Also covers files created in a mapping lib after the last build.
  watcher.addPaths(
    mappingWatchDirs(sharedMappingDirs(normalized.config), normalized.options.workspaceRoot)
  );
  syncNfFileWatcher(watcher, bundlerCache, linkedDirs);

  async function rebuild(signal: AbortSignal) {
    let files: string[] = [];
    try {
      await abortableDelay(Math.max(10, options.rebuildDelay), signal);
      // A rebuild queued behind one that close() aborted gets a fresh, unaborted signal.
      if (closed || signal.aborted) throw new AbortedError('[builder] Aborted before rebuild');

      files = [...pendingChanges];
      pendingChanges.clear();

      federationInfo = await rebuildForFederation(
        normalized.config,
        normalized.options,
        externals,
        files,
        signal
      );

      syncNfFileWatcher(watcher, bundlerCache, linkedDirs);
      logger.info('Federation rebuild done.');
      return { success: true };
    } catch (error) {
      // Only a successful rebuild consumes its changes: core decides from them whether a linked
      // shared package needs re-bundling, so the next rebuild must see them again.
      for (const file of files) pendingChanges.add(file);

      if (error instanceof AbortedError) {
        logger.verbose('Rebuild was canceled: ' + error.message);
        return { success: false, cancelled: true };
      }
      logger.error('Federation rebuild failed!');
      if (options.verbose) console.error(error);
      return { success: false };
    }
  }

  return {
    get federationInfo() {
      return federationInfo;
    },
    externals,
    options,
    close() {
      closing ??= (async () => {
        closed = true;
        rebuildQueue.dispose();
        await lastRebuild;
        await watcher.close();
        await adapter.dispose();
      })();
      return closing;
    },
  };
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new AbortedError('[builder] Debounce canceled'));
      },
      { once: true }
    );
  });
}
