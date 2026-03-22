import type * as esbuild from 'esbuild';
export type ReplacementConfig = {
  file: string;
};

export interface EsBuildAdapterConfig {
  plugins: esbuild.Plugin[];
  fileReplacements?: Record<string, string | ReplacementConfig>;
  compensateExports?: RegExp[];
  loader?: { [ext: string]: esbuild.Loader };
}
