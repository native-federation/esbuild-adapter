import type * as esbuild from 'esbuild';
import type { NfFrameworkPlugin } from './framework-plugin.contract.js';

export type ReplacementConfig = {
  file: string;
};

export interface EsBuildAdapterConfig {
  plugins: esbuild.Plugin[];
  fileReplacements?: Record<string, string | ReplacementConfig>;
  loader?: { [ext: string]: esbuild.Loader };
  frameworks?: NfFrameworkPlugin[];
  // Core's externals cache key can't see adapter options (native-federation-core#152). define and
  // preserveSymlinks therefore skip shared npm packages; target and sourcemap do reach them, so
  // changing those needs a cleared cache.
  define?: Record<string, string>;
  preserveSymlinks?: boolean;
  target?: string | string[];
  sourcemap?: esbuild.BuildOptions['sourcemap'];
}
