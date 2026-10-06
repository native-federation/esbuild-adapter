import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { NFBuildAdapterOptions } from '@softarc/native-federation/domain';
import type { EsBuildAdapterConfig } from '../domain/adapter-config.contract.js';
import { sharedBuildOptions, sharedPackageOptions, sourceBuildOptions } from './build-options.js';
import { resolveAdapterConfig } from './resolve-config.js';

// Options taken from core's request per build; core keys these itself, so they stay out of
// sharedPackageOptions and therefore out of the externals cache key. absWorkingDir is the
// workspace root, which the cache lives under anyway.
const REQUEST_PROVIDED = [
  'entryPoints',
  'outdir',
  'entryNames',
  'external',
  'splitting',
  'platform',
  'absWorkingDir',
];

const request = (overrides: Partial<NFBuildAdapterOptions> = {}): NFBuildAdapterOptions => ({
  entryPoints: [{ fileName: '/workspace/node_modules/foo/index.js', outName: 'foo.js' }],
  external: ['react'],
  outdir: '/workspace/dist',
  mappedPaths: {},
  isMappingOrExposed: false,
  hash: false,
  cache: { externals: [], bundlerCache: undefined, cachePath: '/workspace/.cache' },
  ...overrides,
});

const resolve = (config: Partial<EsBuildAdapterConfig> = {}) =>
  resolveAdapterConfig({ plugins: [], ...config });

const entryFiles = (options: esbuild.BuildOptions) =>
  (options.entryPoints as { in: string }[]).map(ep => ep.in);

describe('sharedBuildOptions', () => {
  // Guard for the externals cache key: an option added to sharedBuildOptions instead of to
  // sharedPackageOptions would silently escape the key and serve stale externals.
  it.each([true, false])('passes only keyed or request-provided options (dev=%s)', dev => {
    const config = resolve({ target: 'es2022', loader: { '.svg': 'text' } });
    const { fileReplacements, plugins, ...keyed } = sharedPackageOptions(config, dev);
    expect(fileReplacements).toEqual({});

    const { plugins: passedPlugins, ...rest } = sharedBuildOptions(
      request({ dev }),
      config,
      '/workspace'
    );
    for (const key of REQUEST_PROVIDED) delete (rest as Record<string, unknown>)[key];

    expect(rest).toEqual(keyed);
    expect(passedPlugins!.slice(1)).toEqual(plugins);
  });

  it('always runs the CommonJS plugin first', () => {
    const user = { name: 'user', setup: () => undefined };
    const options = sharedBuildOptions(request(), resolve({ plugins: [user] }), '/workspace');

    expect(options.plugins!.map(p => p.name)).toEqual(['commonjs', 'user']);
  });

  it('swaps the matching suffix of an entry point and keeps its prefix', () => {
    const config = resolve({
      fileReplacements: { 'node_modules/foo/index.js': 'src/foo-shim.js' },
    });
    const options = sharedBuildOptions(request(), config, '/workspace');

    expect(entryFiles(options)).toEqual(['/workspace/src/foo-shim.js']);
  });

  it('does not modify the entry points core hands in', () => {
    const req = request();
    const config = resolve({
      fileReplacements: { 'node_modules/foo/index.js': 'src/foo-shim.js' },
    });
    sharedBuildOptions(req, config, '/workspace');

    expect(req.entryPoints[0]!.fileName).toBe('/workspace/node_modules/foo/index.js');
  });

  // Keys used to be regexes, so a '.' matched any character.
  it('matches replacement keys literally', () => {
    const config = resolve({ fileReplacements: { 'foo/index.js': 'shim.js' } });
    const options = sharedBuildOptions(
      request({ entryPoints: [{ fileName: '/workspace/foo/index-js', outName: 'foo.js' }] }),
      config,
      '/workspace'
    );

    expect(entryFiles(options)).toEqual(['/workspace/foo/index-js']);
  });

  it('matches Windows entry paths', () => {
    const config = resolve({
      fileReplacements: { 'node_modules/foo/index.js': 'src/foo-shim.js' },
    });
    const options = sharedBuildOptions(
      request({
        entryPoints: [{ fileName: 'C:\\ws\\node_modules\\foo\\index.js', outName: 'foo.js' }],
      }),
      config,
      'C:\\ws'
    );

    expect(entryFiles(options)).toEqual(['C:/ws/src/foo-shim.js']);
  });

  it('appends framework extensions to the npm defaults without duplicates', () => {
    const config = resolve({ frameworks: [{ name: 'fw', resolveExtensions: ['.js', '.vue'] }] });

    expect(sharedBuildOptions(request(), config, '/workspace').resolveExtensions).toEqual([
      '.mjs',
      '.js',
      '.cjs',
      '.vue',
    ]);
  });

  // React's index.js picks its CJS build behind `process.env.NODE_ENV`; the define alone has to
  // keep the other build out of the bundle, which is why no framework swaps those files.
  describe('NODE_ENV entry branches', () => {
    let root: string;

    beforeAll(() => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-esbuild-env-')));
      const pkg = path.join(root, 'node_modules/env-dep');
      fs.mkdirSync(path.join(pkg, 'cjs'), { recursive: true });
      fs.writeFileSync(
        path.join(pkg, 'index.js'),
        [
          `'use strict';`,
          `if (process.env.NODE_ENV === 'production') {`,
          `  module.exports = require('./cjs/env-dep.production.js');`,
          `} else {`,
          `  module.exports = require('./cjs/env-dep.development.js');`,
          `}`,
          '',
        ].join('\n')
      );
      fs.writeFileSync(path.join(pkg, 'cjs/env-dep.production.js'), `exports.mode = '<PROD>';\n`);
      fs.writeFileSync(path.join(pkg, 'cjs/env-dep.development.js'), `exports.mode = '<DEV>';\n`);
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it.each([
      [true, '<DEV>', '<PROD>'],
      [false, '<PROD>', '<DEV>'],
    ])('bundles only the matching build (dev=%s)', async (dev, kept, dropped) => {
      const options = sharedBuildOptions(
        request({
          dev,
          external: [],
          entryPoints: [
            { fileName: path.join(root, 'node_modules/env-dep/index.js'), outName: 'env-dep.js' },
          ],
          outdir: path.join(root, 'dist'),
        }),
        resolve(),
        root
      );
      const result = await esbuild.build({ ...options, sourcemap: false });
      const code = result.outputFiles!.map(f => f.text).join('\n');

      expect(code).toContain(kept);
      expect(code).not.toContain(dropped);
    });
  });
});

describe('sourceBuildOptions', () => {
  it('passes define, preserveSymlinks and the tsconfig, and records a metafile', () => {
    const options = sourceBuildOptions(
      request({ isMappingOrExposed: true, tsConfigPath: '/workspace/tsconfig.json' }),
      resolve({ define: { BUILD_ID: '"42"' }, preserveSymlinks: true }),
      '/workspace'
    );

    expect(options).toMatchObject({
      define: { BUILD_ID: '"42"' },
      preserveSymlinks: true,
      tsconfig: '/workspace/tsconfig.json',
      metafile: true,
    });
  });

  it('adds the shared-mappings plugin only when there are mappings', () => {
    const user = { name: 'user', setup: () => undefined };
    const names = (mappedPaths: NFBuildAdapterOptions['mappedPaths']) =>
      sourceBuildOptions(
        request({ isMappingOrExposed: true, mappedPaths }),
        resolve({ plugins: [user] }),
        '/workspace'
      ).plugins!.map(p => p.name);

    expect(names({})).toEqual(['user']);
    expect(names({ '/workspace/libs/ui/index.ts': '@fixture/ui' })).toEqual([
      'nf-shared-mappings',
      'user',
    ]);
  });

  it('applies neither file replacements nor the CommonJS plugin', () => {
    const options = sourceBuildOptions(
      request({ isMappingOrExposed: true }),
      resolve({ fileReplacements: { 'node_modules/foo/index.js': 'src/foo-shim.js' } }),
      '/workspace'
    );

    expect(entryFiles(options)).toEqual(['/workspace/node_modules/foo/index.js']);
    expect(options.plugins).toEqual([]);
  });
});
