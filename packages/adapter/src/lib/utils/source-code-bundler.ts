import * as esbuild from 'esbuild';
import * as path from 'path';
import type { EntryPoint } from '@softarc/native-federation/domain';
import type { EsBuildAdapterConfig } from '../domain/adapter-config.contract.js';

export async function createSourceCodeEsbuildContext(
  entryPoints: EntryPoint[],
  external: string[],
  outdir: string,
  config: EsBuildAdapterConfig,
  dev: boolean,
  hash: boolean,
  platform: 'browser' | 'node',
  tsConfigPath?: string
): Promise<esbuild.BuildContext> {
  return esbuild.context({
    entryPoints: entryPoints.map((ep) => ({
      in: ep.fileName,
      out: path.parse(ep.outName).name,
    })),
    write: false,
    outdir,
    entryNames: hash ? '[name]-[hash]' : '[name]',
    external,
    loader: config.loader,
    bundle: true,
    sourcemap: dev,
    minify: !dev,
    format: 'esm',
    splitting: false, // Todo: support splitting
    target: ['esnext'],
    platform,
    tsconfig: tsConfigPath,
    plugins: [...config.plugins],
    resolveExtensions: ['.ts', '.tsx', '.mjs', '.js', '.cjs'],
  });
}
