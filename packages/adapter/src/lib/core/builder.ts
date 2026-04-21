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
  logger,
  RebuildQueue,
  setLogLevel,
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

  const adapter = createEsBuildAdapter(options.adapterConfig);
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

  const rebuildQueue = new RebuildQueue();
  const pendingChanges = new Set<string>();
  let closed = false;

  const watcher: NfFileWatcher = createNfWatcher({
    onChange: changedPath => {
      if (closed) return;
      pendingChanges.add(changedPath);
      void triggerRebuild();
    },
  });

  syncNfFileWatcher(watcher, bundlerCache);

  async function triggerRebuild(): Promise<void> {
    await rebuildQueue.track(async signal => {
      try {
        await abortableDelay(Math.max(10, options.rebuildDelay), signal);

        if (signal.aborted) {
          throw new AbortedError('[builder] Aborted before rebuild');
        }

        const files = [...pendingChanges];
        pendingChanges.clear();

        federationInfo = await rebuildForFederation(
          normalized.config,
          normalized.options,
          externals,
          files,
          signal
        );

        syncNfFileWatcher(watcher, bundlerCache);
        logger.info('Federation rebuild done.');
        return { success: true };
      } catch (error) {
        if (error instanceof AbortedError) {
          logger.verbose('Rebuild was canceled: ' + error.message);
          return { success: false, cancelled: true };
        }
        logger.error('Federation rebuild failed!');
        if (options.verbose) console.error(error);
        return { success: false };
      }
    });
  }

  return {
    get federationInfo() {
      return federationInfo;
    },
    externals,
    options,
    async close() {
      closed = true;
      rebuildQueue.dispose();
      await watcher.close();
      await adapter.dispose();
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
