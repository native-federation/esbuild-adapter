import * as esbuild from 'esbuild';
import * as path from 'path';
import type { EntryPoint } from '@softarc/native-federation/domain';
import type { ReplacementConfig } from '../domain/adapter-config.contract.js';
import type { ResolvedFrameworkConfig } from '../core/resolve-framework-config.js';
import { createCommonJsPlugin } from './commonjs-plugin.js';

export const NODE_MODULES_RESOLVE_EXTENSIONS = ['.mjs', '.js', '.cjs'];

// Everything here is derived from the adapter config, so the externals cache key is built from
// this output (see externals-cache-key.ts). Options core passes in stay out of it.
export function nodeModulesBuildOptions(config: ResolvedFrameworkConfig, dev: boolean) {
  const env = dev ? 'development' : 'production';

  return {
    fileReplacements: normalize(config.fileReplacements ?? {}),
    needsCommonJsPlugin: config.needsCommonJsPlugin,
    plugins: config.plugins,
    write: false,
    bundle: true,
    format: 'esm',
    sourcemap: config.sourcemap ?? dev,
    minify: !dev,
    target: config.target,
    loader: config.loader,
    define: {
      'process.env.NODE_ENV': `"${env}"`,
    },
    resolveExtensions: config.resolveExtensions,
  } satisfies Omit<esbuild.BuildOptions, 'plugins'> & {
    fileReplacements: Record<string, ReplacementConfig>;
    needsCommonJsPlugin: boolean;
    plugins: esbuild.Plugin[];
  };
}

export async function createNodeModulesEsbuildContext(
  entryPoints: EntryPoint[],
  external: string[],
  outdir: string,
  config: ResolvedFrameworkConfig,
  dev: boolean,
  hash: boolean,
  chunks: boolean,
  platform: 'browser' | 'node'
): Promise<esbuild.BuildContext> {
  const { fileReplacements, needsCommonJsPlugin, plugins, ...options } = nodeModulesBuildOptions(
    config,
    dev
  );

  if (Object.keys(fileReplacements).length) {
    for (const entryPoint of entryPoints) {
      entryPoint.fileName = replaceEntryPoint(entryPoint.fileName, fileReplacements);
    }
  }

  return esbuild.context({
    ...options,
    entryPoints: entryPoints.map(ep => ({
      in: ep.fileName,
      out: path.parse(ep.outName).name,
    })),
    outdir,
    entryNames: hash ? '[name]-[hash]' : '[name]',
    external,
    splitting: chunks,
    platform,
    plugins: needsCommonJsPlugin ? [createCommonJsPlugin(external), ...plugins] : plugins,
  });
}

function normalize(
  config: Record<string, string | ReplacementConfig>
): Record<string, ReplacementConfig> {
  const result: Record<string, ReplacementConfig> = {};
  for (const key in config) {
    if (typeof config[key] === 'string') {
      result[key] = {
        file: config[key] as string,
      };
    } else {
      result[key] = config[key] as ReplacementConfig;
    }
  }
  return result;
}

function replaceEntryPoint(
  entryPoint: string,
  fileReplacements: Record<string, ReplacementConfig>
): string {
  entryPoint = entryPoint.replace(/\\/g, '/');

  for (const key in fileReplacements) {
    entryPoint = entryPoint.replace(new RegExp(`${key}$`), fileReplacements[key]!.file);
  }

  return entryPoint;
}
