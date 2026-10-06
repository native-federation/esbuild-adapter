import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDefaultCachePath } from '@softarc/native-federation/internal';
import { toDiskCase } from '../utils/disk-case.js';
import { normalizeBuilderOptions } from './normalize-options.js';

vi.mock('../utils/disk-case.js', () => ({ toDiskCase: vi.fn((p: string) => p) }));

describe('normalizeBuilderOptions', () => {
  it('throws when outputPath is missing', () => {
    expect(() => normalizeBuilderOptions({ outputPath: '' })).toThrow(/outputPath is required/);
  });

  it('applies defaults', () => {
    const result = normalizeBuilderOptions({ outputPath: 'dist' });

    expect(result).toEqual({
      workspaceRoot: process.cwd(),
      outputPath: 'dist',
      tsConfig: path.join(process.cwd(), 'tsconfig.json'),
      cachePath: getDefaultCachePath(process.cwd()),
      projectName: undefined,
      entryPoints: undefined,
      packageJson: undefined,
      dev: false,
      watch: false,
      watchLinkedDeps: false,
      watcher: undefined,
      verbose: false,
      rebuildDelay: 50,
      cacheExternalArtifacts: true,
      adapterConfig: { plugins: [] },
    });
  });

  it('passes watchLinkedDeps and the watch port through', () => {
    const watcher = vi.fn();
    expect(
      normalizeBuilderOptions({ outputPath: 'dist', watchLinkedDeps: true, watcher })
    ).toMatchObject({ watchLinkedDeps: true, watcher });
  });

  it('resolves workspaceRoot against cwd and cachePath against workspaceRoot', () => {
    const result = normalizeBuilderOptions({
      outputPath: 'dist',
      workspaceRoot: 'apps/remote',
      cachePath: '.cache/nf',
    });

    const expectedRoot = path.resolve(process.cwd(), 'apps/remote');
    expect(result.workspaceRoot).toBe(expectedRoot);
    expect(result.cachePath).toBe(path.join(expectedRoot, '.cache/nf'));
  });

  // Core passes tsConfig to esbuild unchanged, and esbuild resolves a relative one against cwd.
  it('resolves tsConfig against workspaceRoot', () => {
    const result = normalizeBuilderOptions({
      outputPath: 'dist',
      workspaceRoot: 'apps/remote',
      tsConfig: 'tsconfig.app.json',
    });

    expect(result.tsConfig).toBe(path.resolve(process.cwd(), 'apps/remote/tsconfig.app.json'));
  });

  describe('without a tsConfig', () => {
    let root: string;
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-tsconfig-'));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('defaults to tsconfig.json in workspaceRoot', () => {
      fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
      expect(normalizeBuilderOptions({ outputPath: 'dist', workspaceRoot: root }).tsConfig).toBe(
        path.join(root, 'tsconfig.json')
      );
    });

    // e.g. a monorepo app with only tsconfig.app.json: esbuild must find the nearest tsconfig
    // itself, as an explicit path to a missing file fails the build.
    it('leaves it unset when workspaceRoot has no tsconfig.json', () => {
      expect(
        normalizeBuilderOptions({ outputPath: 'dist', workspaceRoot: root }).tsConfig
      ).toBeUndefined();
    });
  });

  it('keeps an absolute tsConfig as-is', () => {
    const tsConfig = path.resolve('/tmp/other/tsconfig.json');
    expect(
      normalizeBuilderOptions({ outputPath: 'dist', workspaceRoot: 'apps/remote', tsConfig })
        .tsConfig
    ).toBe(tsConfig);
  });

  it('keeps an absolute cachePath as-is', () => {
    const cachePath = path.resolve('/tmp/nf-cache');
    expect(
      normalizeBuilderOptions({ outputPath: 'dist', workspaceRoot: 'apps/remote', cachePath })
        .cachePath
    ).toBe(cachePath);
  });

  it('keeps an absolute workspaceRoot as-is', () => {
    const root = path.resolve('/tmp/some-workspace');
    expect(normalizeBuilderOptions({ outputPath: 'dist', workspaceRoot: root }).workspaceRoot).toBe(
      root
    );
  });

  // Core re-cases the root it builds from, so the adapter's own derived paths must agree with it.
  it('derives workspaceRoot, cachePath and tsConfig from the on-disk spelling of the root', () => {
    const shellRoot = path.resolve('/tmp/ws');
    const diskRoot = path.resolve('/tmp/WS');
    vi.mocked(toDiskCase).mockImplementationOnce(p => (p === shellRoot ? diskRoot : p));

    const result = normalizeBuilderOptions({
      outputPath: 'dist',
      workspaceRoot: shellRoot,
      cachePath: '.cache/nf',
      tsConfig: 'tsconfig.app.json',
    });

    expect(toDiskCase).toHaveBeenCalledWith(shellRoot);
    expect(result.workspaceRoot).toBe(diskRoot);
    expect(result.cachePath).toBe(path.join(diskRoot, '.cache/nf'));
    expect(result.tsConfig).toBe(path.join(diskRoot, 'tsconfig.app.json'));
  });

  it('passes explicit values through', () => {
    const adapterConfig = { plugins: [] };
    const result = normalizeBuilderOptions({
      outputPath: 'dist',
      tsConfig: 'tsconfig.app.json',
      projectName: 'remote',
      entryPoints: ['src/main.ts'],
      packageJson: 'package.json',
      dev: true,
      watch: true,
      verbose: true,
      rebuildDelay: 200,
      cacheExternalArtifacts: false,
      adapterConfig,
    });

    expect(result).toMatchObject({
      projectName: 'remote',
      entryPoints: ['src/main.ts'],
      packageJson: 'package.json',
      dev: true,
      watch: true,
      verbose: true,
      rebuildDelay: 200,
      cacheExternalArtifacts: false,
    });
    expect(result.adapterConfig).toBe(adapterConfig);
  });
});
