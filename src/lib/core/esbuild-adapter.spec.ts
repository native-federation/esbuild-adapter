import type * as esbuildTypes from 'esbuild';
import * as os from 'os';
import * as path from 'path';
import type { NFBuildAdapterOptions } from '@softarc/native-federation/domain';
import { AbortedError } from '@softarc/native-federation/internal';
import type { EsBuildAdapterConfig } from '../domain/adapter-config.contract.js';
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
    rebuild: vi.fn(async () => ({
      outputFiles: [],
      metafile: { inputs: metafileInputs, outputs: {} },
    })),
    cancel: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  })),
  stop: vi.fn(async () => undefined),
}));

const esbuild = await import('esbuild');

const workspaceRoot = path.resolve('/workspace/apps/remote');
const posix = (p: string) => p.split(path.sep).join('/');

const setupOptions = (
  isMappingOrExposed: boolean,
  bundlerCache: EsbuildBundlerCache = new Map(),
  entry = 'src/exposed.ts'
): NFBuildAdapterOptions<EsbuildBundlerCache> => ({
  entryPoints: [{ fileName: path.join(workspaceRoot, entry), outName: 'exposed.js' }],
  external: [],
  outdir: path.join(workspaceRoot, 'dist'),
  mappedPaths: {},
  isMappingOrExposed,
  hash: true,
  cache: { externals: [], bundlerCache, cachePath: path.join(workspaceRoot, '.cache') },
});

describe('createEsBuildAdapter', () => {
  beforeEach(() => {
    vi.mocked(esbuild.context).mockClear();
    vi.mocked(esbuild.stop).mockClear();
  });

  const contextAt = async (i: number) =>
    (await vi.mocked(esbuild.context).mock.results[i]!.value) as {
      rebuild: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    };

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

  it('does not modify the config it is given', () => {
    const config: EsBuildAdapterConfig = { plugins: [] };
    createEsBuildAdapter(config);

    expect(config).toEqual({ plugins: [] });
  });

  // Core skips dispose(name) when a shared build throws, so the next setup must not reuse the
  // context it left behind.
  it('replaces the context when a bundle is set up again', async () => {
    const adapter = createEsBuildAdapter({ plugins: [] }, { workspaceRoot });
    await adapter.setup('bundle', setupOptions(false, undefined, 'src/old.ts'));
    await adapter.setup('bundle', setupOptions(false, undefined, 'src/new.ts'));

    expect(vi.mocked(esbuild.context)).toHaveBeenCalledTimes(2);
    expect((await contextAt(0)).dispose).toHaveBeenCalledOnce();
    expect(vi.mocked(esbuild.context).mock.calls[1]![0].entryPoints).toEqual([
      { in: path.join(workspaceRoot, 'src/new.ts'), out: 'exposed' },
    ]);

    await adapter.build('bundle');
    expect((await contextAt(1)).rebuild).toHaveBeenCalledOnce();
  });

  // The esbuild service is shared by every context in the process, other builders included.
  it('disposes its contexts but leaves the esbuild service running', async () => {
    const adapter = createEsBuildAdapter({ plugins: [] }, { workspaceRoot });
    await adapter.setup('a', setupOptions(true));
    await adapter.setup('b', setupOptions(false));
    await adapter.dispose();

    expect((await contextAt(0)).dispose).toHaveBeenCalledOnce();
    expect((await contextAt(1)).dispose).toHaveBeenCalledOnce();
    expect(esbuild.stop).not.toHaveBeenCalled();
    await expect(adapter.build('a')).rejects.toThrow('No context found');
  });

  // Core runs the separate shared bundles with Promise.all; when one fails, the builder disposes
  // the adapter while its siblings are still waiting on esbuild.context().
  it('disposes a context that finishes setting up after the adapter was disposed', async () => {
    const adapter = createEsBuildAdapter({ plugins: [] }, { workspaceRoot });
    const late = {
      rebuild: vi.fn(),
      cancel: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const { promise, resolve } = Promise.withResolvers<typeof late>();
    vi.mocked(esbuild.context).mockImplementationOnce(
      () => promise as unknown as ReturnType<typeof esbuild.context>
    );

    const setup = adapter.setup('late', setupOptions(false));
    await vi.waitFor(() => expect(esbuild.context).toHaveBeenCalledOnce());
    await adapter.dispose();
    resolve(late);

    await expect(setup).rejects.toBeInstanceOf(AbortedError);
    expect(late.dispose).toHaveBeenCalledOnce();
    await expect(adapter.build('late')).rejects.toThrow('No context found');
  });

  it('keeps working for setups started after a dispose', async () => {
    const adapter = createEsBuildAdapter({ plugins: [] }, { workspaceRoot });
    await adapter.dispose();
    await adapter.setup('bundle', setupOptions(true));

    await expect(adapter.build('bundle')).resolves.toEqual([]);
  });

  it('ignores disposing a bundle that does not exist', async () => {
    const adapter = createEsBuildAdapter({ plugins: [] });
    await expect(adapter.dispose('missing')).resolves.toBeUndefined();
  });

  it('cancels the esbuild rebuild and reports an abort when the signal fires', async () => {
    const adapter = createEsBuildAdapter({ plugins: [] }, { workspaceRoot });
    await adapter.setup('bundle', setupOptions(true));
    const ctx = await contextAt(0);
    const controller = new AbortController();
    ctx.rebuild.mockImplementationOnce(async () => {
      controller.abort();
      // esbuild's own wording; the adapter must not depend on it.
      throw new Error('The build was canceled');
    });

    await expect(adapter.build('bundle', { signal: controller.signal })).rejects.toBeInstanceOf(
      AbortedError
    );
    expect(ctx.cancel).toHaveBeenCalledOnce();
  });

  it('does not record the output of a rebuild that finished after an abort', async () => {
    const bundlerCache: EsbuildBundlerCache = new Map();
    const adapter = createEsBuildAdapter({ plugins: [] }, { workspaceRoot });
    await adapter.setup('bundle', setupOptions(true, bundlerCache));
    const ctx = await contextAt(0);
    const controller = new AbortController();
    ctx.rebuild.mockImplementationOnce(async () => {
      controller.abort();
      return { outputFiles: [], metafile: { inputs: metafileInputs, outputs: {} } };
    });

    await expect(adapter.build('bundle', { signal: controller.signal })).rejects.toBeInstanceOf(
      AbortedError
    );
    expect(bundlerCache.size).toBe(0);
  });
});
