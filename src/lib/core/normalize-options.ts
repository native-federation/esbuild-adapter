import * as path from 'path';
import type {
  EsBuildBuilderOptions,
  NormalizedEsBuildBuilderOptions,
} from '../domain/builder-config.contract.js';
import { getDefaultCachePath } from '@softarc/native-federation/internal';
import { toDiskCase } from '../utils/disk-case.js';

export function normalizeBuilderOptions(
  options: EsBuildBuilderOptions
): NormalizedEsBuildBuilderOptions {
  if (!options.outputPath) {
    throw new Error('[esbuild-builder] outputPath is required');
  }

  const workspaceRoot = toDiskCase(
    options.workspaceRoot ? path.resolve(process.cwd(), options.workspaceRoot) : process.cwd()
  );

  const tsConfig = options.tsConfig ?? 'tsconfig.json';
  const cachePath = options.cachePath
    ? path.resolve(workspaceRoot, options.cachePath)
    : getDefaultCachePath(workspaceRoot);

  return {
    workspaceRoot,
    outputPath: options.outputPath,
    tsConfig,
    cachePath,
    projectName: options.projectName,
    entryPoints: options.entryPoints,
    packageJson: options.packageJson,
    dev: !!options.dev,
    watch: !!options.watch,
    watchLinkedDeps: options.watchLinkedDeps === true,
    watcher: options.watcher,
    verbose: !!options.verbose,
    rebuildDelay: options.rebuildDelay ?? 50,
    cacheExternalArtifacts: options.cacheExternalArtifacts !== false,
    adapterConfig: options.adapterConfig ?? { plugins: [] },
  };
}
