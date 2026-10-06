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
  // define and preserveSymlinks skip shared npm packages; fileReplacements, loader, target and
  // sourcemap reach them and are part of the externals cache key.
  define?: Record<string, string>;
  preserveSymlinks?: boolean;
  target?: string | string[];
  sourcemap?: esbuild.BuildOptions['sourcemap'];
}
