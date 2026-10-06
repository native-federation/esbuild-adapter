import type * as esbuild from 'esbuild';
import * as path from 'path';
import type { EntryPoint, NFBuildAdapterOptions } from '@softarc/native-federation/domain';
import type { ResolvedAdapterConfig } from './resolve-config.js';
import { createCommonJsPlugin } from './commonjs-plugin.js';
import { createSharedMappingsPlugin } from './shared-mappings-plugin.js';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.cjs'];
const SHARED_EXTENSIONS = ['.mjs', '.js', '.cjs'];

// Exposed modules and shared mappings: the user's own code.
export function sourceBuildOptions(
  request: NFBuildAdapterOptions,
  config: ResolvedAdapterConfig,
  absWorkingDir: string
): esbuild.BuildOptions {
  const dev = !!request.dev;
  const hasMappings = Object.keys(request.mappedPaths).length > 0;

  return {
    ...requestOptions(request, absWorkingDir, request.entryPoints),
    write: false,
    metafile: true,
    bundle: true,
    format: 'esm',
    sourcemap: config.sourcemap ?? dev,
    minify: !dev,
    target: config.target,
    loader: config.loader,
    define: config.define,
    preserveSymlinks: config.preserveSymlinks,
    tsconfig: request.tsConfigPath,
    resolveExtensions: withDefaults(SOURCE_EXTENSIONS, config.resolveExtensions),
    plugins: [
      ...(hasMappings ? [createSharedMappingsPlugin(request.mappedPaths)] : []),
      ...config.plugins,
    ],
  };
}

// Shared npm packages. Their output is cached across builds, so every option derived from the
// adapter config lives in sharedPackageOptions, which the externals cache key is built from.
export function sharedBuildOptions(
  request: NFBuildAdapterOptions,
  config: ResolvedAdapterConfig,
  absWorkingDir: string
): esbuild.BuildOptions {
  const { fileReplacements, needsCommonJsPlugin, plugins, ...options } = sharedPackageOptions(
    config,
    !!request.dev
  );
  const entryPoints = request.entryPoints.map(ep => ({
    ...ep,
    fileName: replaceSuffix(ep.fileName, fileReplacements),
  }));

  return {
    ...options,
    ...requestOptions(request, absWorkingDir, entryPoints),
    plugins: needsCommonJsPlugin ? [createCommonJsPlugin(request.external), ...plugins] : plugins,
  };
}

// No user `define` here: it can't reach the cache key without invalidating it on every change.
export function sharedPackageOptions(config: ResolvedAdapterConfig, dev: boolean) {
  return {
    fileReplacements: config.fileReplacements[dev ? 'dev' : 'prod'],
    needsCommonJsPlugin: config.needsCommonJsPlugin,
    plugins: config.plugins,
    write: false,
    bundle: true,
    format: 'esm',
    sourcemap: config.sourcemap ?? dev,
    minify: !dev,
    target: config.target,
    loader: config.loader,
    define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
    resolveExtensions: withDefaults(SHARED_EXTENSIONS, config.resolveExtensions),
  } satisfies esbuild.BuildOptions & {
    fileReplacements: Record<string, string>;
    needsCommonJsPlugin: boolean;
  };
}

function requestOptions(
  request: NFBuildAdapterOptions,
  absWorkingDir: string,
  entryPoints: EntryPoint[]
) {
  return {
    absWorkingDir,
    entryPoints: entryPoints.map(ep => ({ in: ep.fileName, out: path.parse(ep.outName).name })),
    outdir: request.outdir,
    entryNames: request.hash ? '[name]-[hash]' : '[name]',
    external: request.external,
    splitting: !!request.chunks,
    platform: request.platform === 'node' ? 'node' : 'browser',
  } satisfies esbuild.BuildOptions;
}

function withDefaults(defaults: string[], extra: string[]): string[] {
  return [...defaults, ...extra.filter(ext => !defaults.includes(ext))];
}

// Keys match the end of the entry path and only that end is swapped, so a key like
// `node_modules/foo/index.js` keeps the workspace prefix in front of its replacement.
function replaceSuffix(fileName: string, replacements: Record<string, string>): string {
  const file = fileName.replace(/\\/g, '/');
  const key = Object.keys(replacements).find(from => file.endsWith(from));
  return key ? file.slice(0, -key.length) + replacements[key] : fileName;
}
