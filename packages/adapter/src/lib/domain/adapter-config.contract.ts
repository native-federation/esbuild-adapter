import type * as esbuild from 'esbuild';
import type { NfFrameworkPlugin } from './framework-plugin.contract.js';

export type ReplacementConfig = {
  file: string;
};

export interface EsBuildAdapterConfig {
  plugins: esbuild.Plugin[];
  fileReplacements?: Record<string, string | ReplacementConfig>;
  compensateExports?: RegExp[];
  loader?: { [ext: string]: esbuild.Loader };
  frameworks?: NfFrameworkPlugin[];
}
