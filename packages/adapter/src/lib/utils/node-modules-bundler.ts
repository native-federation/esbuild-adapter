import * as esbuild from 'esbuild';
import * as path from 'path';
import type { EntryPoint } from '@softarc/native-federation/domain';
import type { EsBuildAdapterConfig, ReplacementConfig } from '../domain/adapter-config.contract.js';

export async function createNodeModulesEsbuildContext(
  entryPoints: EntryPoint[],
  external: string[],
  outdir: string,
  config: EsBuildAdapterConfig,
  dev: boolean,
  hash: boolean,
  platform: 'browser' | 'node'
): Promise<esbuild.BuildContext> {
  const env = dev ? 'development' : 'production';

  // Apply file replacements to entry points
  if (config.fileReplacements) {
    const normalizedReplacements = normalize(config.fileReplacements);
    for (const entryPoint of entryPoints) {
      entryPoint.fileName = replaceEntryPoint(entryPoint.fileName, normalizedReplacements);
    }
  }

  const commonjsPluginModule = await import('@chialab/esbuild-plugin-commonjs');
  const commonjsPlugin = commonjsPluginModule.default;

  return esbuild.context({
    entryPoints: entryPoints.map((ep) => ({
      in: ep.fileName,
      out: path.parse(ep.outName).name,
    })),
    write: false,
    outdir,
    entryNames: hash ? '[name]-[hash]' : '[name]',
    external,
    bundle: true,
    sourcemap: dev,
    minify: !dev,
    format: 'esm',
    platform,
    plugins: [commonjsPlugin()],
    define: {
      'process.env.NODE_ENV': `"${env}"`,
    },
    resolveExtensions: ['.mjs', '.js', '.cjs'],
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
