import * as esbuild from 'esbuild';
import * as path from 'path';
import type { EntryPoint } from '@softarc/native-federation/domain';
import type { PathToImport } from '@softarc/native-federation/internal';
import type { ResolvedFrameworkConfig } from '../core/resolve-framework-config.js';
import { createSharedMappingsPlugin } from './shared-mappings-plugin.js';

export async function createSourceCodeEsbuildContext(
  entryPoints: EntryPoint[],
  external: string[],
  mappedPaths: PathToImport,
  outdir: string,
  config: ResolvedFrameworkConfig,
  dev: boolean,
  hash: boolean,
  chunks: boolean,
  platform: 'browser' | 'node',
  tsConfigPath?: string
): Promise<esbuild.BuildContext> {
  return esbuild.context({
    entryPoints: entryPoints.map(ep => ({
      in: ep.fileName,
      out: path.parse(ep.outName).name,
    })),
    write: false,
    metafile: true,
    outdir,
    entryNames: hash ? '[name]-[hash]' : '[name]',
    external,
    loader: config.loader,
    bundle: true,
    sourcemap: dev,
    minify: !dev,
    format: 'esm',
    splitting: chunks,
    target: ['esnext'],
    platform,
    tsconfig: tsConfigPath,
    plugins: [
      ...(Object.keys(mappedPaths).length > 0 ? [createSharedMappingsPlugin(mappedPaths)] : []),
      ...config.plugins,
    ],
    resolveExtensions: config.resolveExtensions,
  });
}
