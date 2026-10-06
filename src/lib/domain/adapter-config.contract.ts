import type * as esbuild from 'esbuild';
import type { NfFrameworkPlugin } from './framework-plugin.contract.js';

export type ReplacementConfig = {
  file: string;
};

export interface EsBuildAdapterOptions {
  // esbuild's working dir: relative paths and output hashes resolve against it. Defaults to cwd.
  workspaceRoot?: string;
}

export interface EsBuildAdapterConfig {
  plugins: esbuild.Plugin[];
  // Swaps the entry file of a shared npm package by path suffix; imports in source are untouched.
  fileReplacements?: Record<string, string | ReplacementConfig>;
  loader?: { [ext: string]: esbuild.Loader };
  frameworks?: NfFrameworkPlugin[];
  // define and preserveSymlinks skip shared npm packages; see build-options.ts for what reaches
  // them and invalidates the externals cache.
  define?: Record<string, string>;
  preserveSymlinks?: boolean;
  target?: string | string[];
  sourcemap?: esbuild.BuildOptions['sourcemap'];
}
