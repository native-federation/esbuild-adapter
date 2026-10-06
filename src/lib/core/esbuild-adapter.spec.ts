import type * as esbuildTypes from 'esbuild';
import * as os from 'os';
import * as path from 'path';
import type { NFBuildAdapterOptions } from '@softarc/native-federation/domain';
import type { EsbuildBundlerCache } from '../domain/adapter-context.contract.js';
import { createEsBuildAdapter } from './esbuild-adapter.js';

// esbuild pins its working dir when it is first loaded, so a chdir inside a test can't show the
// cwd dependence; assert what reaches esbuild and what the adapter makes of its metafile instead.
const metafileInputs = {
  'src/exposed.ts': {},
  'libs/ui/index.ts': {},
  // Virtual modules from the commonjs plugin and esbuild itself; not files to watch.
  'nf-cjs-external:react': {},
  '<define:process.env.NODE_ENV>': {},
};

vi.mock('esbuild', async importOriginal => ({
  ...(await importOriginal<typeof esbuildTypes>()),
  context: vi.fn(async () => ({
    rebuild: async () => ({ outputFiles: [], metafile: { inputs: metafileInputs, outputs: {} } }),
    cancel: () => undefined,
    dispose: async () => undefined,
  })),
}));

const esbuild = await import('esbuild');

const workspaceRoot = path.resolve('/workspace/apps/remote');
const posix = (p: string) => p.split(path.sep).join('/');

const setupOptions = (
  isMappingOrExposed: boolean,
  bundlerCache: EsbuildBundlerCache = new Map()
): NFBuildAdapterOptions<EsbuildBundlerCache> => ({
  entryPoints: [{ fileName: path.join(workspaceRoot, 'src/exposed.ts'), outName: 'exposed.js' }],
  external: [],
  outdir: path.join(workspaceRoot, 'dist'),
  mappedPaths: {},
  isMappingOrExposed,
  hash: true,
  cache: { externals: [], bundlerCache, cachePath: path.join(workspaceRoot, '.cache') },
});

describe('createEsBuildAdapter', () => {
  beforeEach(() => vi.mocked(esbuild.context).mockClear());

  // Output names hash the entry paths relative to esbuild's working dir.
  it.each([true, false])(
    'runs esbuild from the workspace root (isMappingOrExposed=%s)',
    async isMappingOrExposed => {
      const adapter = createEsBuildAdapter({ plugins: [], frameworks: [] }, { workspaceRoot });
      await adapter.setup('bundle', setupOptions(isMappingOrExposed));

      expect(vi.mocked(esbuild.context).mock.calls[0]![0].absWorkingDir).toBe(workspaceRoot);
    }
  );

  it('defaults the working dir to cwd', async () => {
    const adapter = createEsBuildAdapter({ plugins: [], frameworks: [] });
    await adapter.setup('bundle', setupOptions(true));

    expect(vi.mocked(esbuild.context).mock.calls[0]![0].absWorkingDir).toBe(process.cwd());
  });

  // esbuild rejects a relative absWorkingDir.
  it('resolves a relative workspace root against cwd', async () => {
    const adapter = createEsBuildAdapter(
      { plugins: [], frameworks: [] },
      { workspaceRoot: 'apps/remote' }
    );
    await adapter.setup('bundle', setupOptions(true));

    expect(vi.mocked(esbuild.context).mock.calls[0]![0].absWorkingDir).toBe(
      path.resolve('apps/remote')
    );
  });

  // Hosts may chdir into the project after creating the adapter; esbuild itself reads cwd per context.
  it('reads cwd at setup, not when the adapter is created', async () => {
    const adapter = createEsBuildAdapter({ plugins: [], frameworks: [] });
    const cwd = process.cwd();
    process.chdir(os.tmpdir());
    const setupCwd = process.cwd();
    try {
      await adapter.setup('bundle', setupOptions(true));
    } finally {
      process.chdir(cwd);
    }

    expect(vi.mocked(esbuild.context).mock.calls[0]![0].absWorkingDir).toBe(setupCwd);
  });

  // The watcher reports changes as absolute posix paths, which must match these keys.
  it('records the bundled files as absolute posix paths under the workspace root', async () => {
    const bundlerCache: EsbuildBundlerCache = new Map();
    const adapter = createEsBuildAdapter({ plugins: [], frameworks: [] }, { workspaceRoot });
    await adapter.setup('bundle', setupOptions(true, bundlerCache));
    await adapter.build('bundle');

    expect([...bundlerCache.keys()]).toEqual([
      posix(path.join(workspaceRoot, 'src/exposed.ts')),
      posix(path.join(workspaceRoot, 'libs/ui/index.ts')),
    ]);
  });
});
