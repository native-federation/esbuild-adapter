import type * as esbuild from 'esbuild';
import type { ReplacementConfig } from './adapter-config.contract.js';

export interface NfFrameworkPluginReplacements {
  dev?: Record<string, string | ReplacementConfig>;
  prod?: Record<string, string | ReplacementConfig>;
}

export interface NfFrameworkPlugin {
  name: string;
  fileReplacements?: NfFrameworkPluginReplacements;
  resolveExtensions?: string[];
  loader?: Record<string, esbuild.Loader>;
  esbuildPlugins?: esbuild.Plugin[];
  needsCommonJsPlugin?: boolean;
}
