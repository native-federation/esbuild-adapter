import type { WatchPort } from '@softarc/native-federation/internal';
import type { EsBuildAdapterConfig } from './adapter-config.contract.js';

export interface EsBuildBuilderOptions {
  workspaceRoot?: string;
  outputPath: string;
  tsConfig?: string;
  cachePath?: string;
  projectName?: string;
  entryPoints?: string[];
  packageJson?: string;
  dev?: boolean;
  watch?: boolean;
  watchLinkedDeps?: boolean;
  watcher?: WatchPort['watch'];
  verbose?: boolean;
  rebuildDelay?: number;
  cacheExternalArtifacts?: boolean;
  adapterConfig?: EsBuildAdapterConfig;
}

export interface NormalizedEsBuildBuilderOptions {
  workspaceRoot: string;
  outputPath: string;
  cachePath: string;
  tsConfig?: string;
  projectName?: string;
  entryPoints?: string[];
  packageJson?: string;
  dev: boolean;
  watch: boolean;
  watchLinkedDeps: boolean;
  watcher?: WatchPort['watch'];
  verbose: boolean;
  rebuildDelay: number;
  cacheExternalArtifacts: boolean;
  adapterConfig: EsBuildAdapterConfig;
}
