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
  const { fileReplacements, plugins, ...options } = sharedPackageOptions(config, !!request.dev);
  const entryPoints = request.entryPoints.map(ep => ({
    ...ep,
    fileName: replaceSuffix(ep.fileName, fileReplacements),
  }));

  return {
    ...options,
    ...requestOptions(request, absWorkingDir, entryPoints),
    plugins: [createCommonJsPlugin(request.external), ...plugins],
  };
}

// No user `define` here: it can't reach the cache key without invalidating it on every change.
// The NODE_ENV define also makes esbuild drop the unused branch of `if (NODE_ENV === ...)
// require(...)` entry files such as React's, so no dev/prod file swap is needed.
export function sharedPackageOptions(config: ResolvedAdapterConfig, dev: boolean) {
  return {
    fileReplacements: config.fileReplacements[dev ? 'dev' : 'prod'],
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
  } satisfies esbuild.BuildOptions & { fileReplacements: Record<string, string> };
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

// Keys match whole trailing path segments and only that end is swapped, so a key like
// `node_modules/foo/index.js` keeps the workspace prefix in front of its replacement. The last
// matching key wins (see mergeReplacements).
function replaceSuffix(fileName: string, replacements: Record<string, string>): string {
  const file = fileName.replace(/\\/g, '/');
  const key = Object.keys(replacements).findLast(from => endsWithSegments(file, from));
  return key ? file.slice(0, -key.length) + replacements[key] : fileName;
}

function endsWithSegments(file: string, suffix: string): boolean {
  const start = file.length - suffix.length;
  return (
    file.endsWith(suffix) && (start === 0 || suffix.startsWith('/') || file[start - 1] === '/')
  );
}
