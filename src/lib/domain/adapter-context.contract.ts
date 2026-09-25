import type { NFBuildAdapterContext } from '@softarc/native-federation';
import type * as esbuild from 'esbuild';

export type EsbuildBundlerCache = Map<string, unknown>;

export interface CachedContext extends NFBuildAdapterContext<esbuild.BuildContext> {
  bundlerCache: EsbuildBundlerCache | undefined;
}
