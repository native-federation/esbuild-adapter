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
  // define and preserveSymlinks skip shared npm packages; see externals-cache-key.ts for what
  // reaches them and invalidates the externals cache.
  define?: Record<string, string>;
  preserveSymlinks?: boolean;
  target?: string | string[];
  sourcemap?: esbuild.BuildOptions['sourcemap'];
}
