import * as path from 'path';
import { getDefaultCachePath } from '@softarc/native-federation/internal';
import { normalizeBuilderOptions } from './normalize-options.js';

describe('normalizeBuilderOptions', () => {
  it('throws when outputPath is missing', () => {
    expect(() => normalizeBuilderOptions({ outputPath: '' })).toThrow(/outputPath is required/);
  });

  it('applies defaults', () => {
    const result = normalizeBuilderOptions({ outputPath: 'dist' });

    expect(result).toEqual({
      workspaceRoot: process.cwd(),
      outputPath: 'dist',
      tsConfig: 'tsconfig.json',
      cachePath: getDefaultCachePath(process.cwd()),
      projectName: undefined,
      entryPoints: undefined,
      packageJson: undefined,
      dev: false,
      watch: false,
      verbose: false,
      rebuildDelay: 50,
      cacheExternalArtifacts: true,
      adapterConfig: { plugins: [] },
    });
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

  it('keeps an absolute workspaceRoot as-is', () => {
    const root = path.resolve('/tmp/some-workspace');
    expect(normalizeBuilderOptions({ outputPath: 'dist', workspaceRoot: root }).workspaceRoot).toBe(
      root
    );
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
      tsConfig: 'tsconfig.app.json',
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
