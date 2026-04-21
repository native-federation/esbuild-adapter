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
  verbose?: boolean;
  rebuildDelay?: number;
  cacheExternalArtifacts?: boolean;
  adapterConfig?: EsBuildAdapterConfig;
}

export interface NormalizedEsBuildBuilderOptions {
  workspaceRoot: string;
  outputPath: string;
  cachePath: string;
  tsConfig: string;
  projectName?: string;
  entryPoints?: string[];
  packageJson?: string;
  dev: boolean;
  watch: boolean;
  verbose: boolean;
  rebuildDelay: number;
  cacheExternalArtifacts: boolean;
  adapterConfig: EsBuildAdapterConfig;
}
