import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import type { FederationInfo, SharedInfo } from '@softarc/native-federation';
import type * as BuilderModule from './builder.js';
import type { EsBuildAdapterConfig } from '../domain/adapter-config.contract.js';
import type * as CoreModule from '@softarc/native-federation';
import type * as InternalModule from '@softarc/native-federation/internal';
import type { NfFileWatcher, NfFileWatcherOptions } from '@softarc/native-federation/internal';

// Watch mode gets a fake watcher so the specs can fire changes and inspect what is watched;
// createNfWatcher is only called with watch on, so one-shot builds are unaffected.
const fakeWatcher = vi.hoisted(() => ({
  options: undefined as NfFileWatcherOptions | undefined,
  added: [] as { paths: string[]; poll: boolean }[],
}));

vi.mock('@softarc/native-federation/internal', async importOriginal => ({
  ...(await importOriginal<typeof InternalModule>()),
  createNfWatcher: (options: NfFileWatcherOptions): NfFileWatcher => {
    fakeWatcher.options = options;
    return {
      addPaths: (paths, opts) =>
        fakeWatcher.added.push({ paths: [paths].flat(), poll: !!opts?.poll }),
      close: async () => undefined,
      get: () => new Set(),
      clear: () => undefined,
      mutate: () => undefined,
    };
  },
}));

vi.mock('@softarc/native-federation', async importOriginal => {
  const actual = await importOriginal<typeof CoreModule>();
  return { ...actual, rebuildForFederation: vi.fn(actual.rebuildForFederation) };
});

// Minimal workspace: one shared npm package, one exposed module and one tsconfig path mapping.
function createFixture(root: string): void {
  const write = (file: string, content: string) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  write(
    'package.json',
    JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      dependencies: { 'tiny-dep': '1.2.3', 'modern-dep': '2.0.0', 'linked-dep': '1.0.0' },
    })
  );
  write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        target: 'es2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        paths: {
          '@fixture/ui': ['./libs/ui/index.ts'],
          '@fixture/kit': ['./libs/kit/index.ts'],
        },
      },
    })
  );
  write(
    'node_modules/tiny-dep/package.json',
    JSON.stringify({ name: 'tiny-dep', version: '1.2.3', type: 'module', exports: './index.js' })
  );
  write('node_modules/tiny-dep/index.js', `export const greet = name => 'hello ' + name;\n`);
  write('libs/ui/index.ts', `export const button = (label: string) => '[' + label + ']';\n`);
  write(
    'src/component.ts',
    [
      `import { greet } from 'tiny-dep';`,
      `import { button } from '@fixture/ui';`,
      `export const render = () => button(greet('world'));`,
      '',
    ].join('\n')
  );
  write(
    'federation.config.mjs',
    [
      `import { withNativeFederation, share } from '@softarc/native-federation/config';`,
      `export default withNativeFederation({`,
      `  name: 'fixture',`,
      `  exposes: { './component': './src/component.ts' },`,
      `  shared: share({ 'tiny-dep': { singleton: true, strictVersion: true, requiredVersion: 'auto' } }),`,
      `  sharedMappings: ['@fixture/ui'],`,
      `});`,
      '',
    ].join('\n')
  );

  // Two exposes importing the same module, so esbuild has something to split out.
  write('src/common.ts', `export const shout = (s: string) => s.toUpperCase() + '!!!';\n`);
  write('src/a.ts', `import { shout } from './common';\nexport const a = () => shout('a');\n`);
  write('src/b.ts', `import { shout } from './common';\nexport const b = () => shout('b');\n`);
  for (const [file, options] of [
    ['federation.no-chunks.config.mjs', `chunks: false,`],
    ['federation.chunks.config.mjs', `chunks: true, features: { denseChunking: true },`],
  ] as const) {
    write(
      file,
      [
        `import { withNativeFederation } from '@softarc/native-federation/config';`,
        `export default withNativeFederation({`,
        `  name: 'chunked',`,
        `  exposes: { './a': './src/a.ts', './b': './src/b.ts' },`,
        `  shared: {},`,
        `  ${options}`,
        `});`,
        '',
      ].join('\n')
    );
  }

  // An expose reaching into a mapped lib by relative path, both through a file the barrel
  // re-exports and through one it keeps private.
  write('libs/kit/index.ts', `export * from './button';\n`);
  write('libs/kit/button.ts', `export const kitButton = (s: string) => s + '<KIT_BUTTON>';\n`);
  write('libs/kit/internal.ts', `export const secret = () => '<KIT_INTERNAL>';\n`);
  write(
    'src/deep.ts',
    [
      `import { kitButton } from '@fixture/kit';`,
      `import { kitButton as deepButton } from '../libs/kit/button';`,
      `import { secret } from '../libs/kit/internal';`,
      `export const render = () => kitButton('a') + deepButton('b') + secret();`,
      '',
    ].join('\n')
  );
  write(
    'federation.mappings.config.mjs',
    [
      `import { withNativeFederation } from '@softarc/native-federation/config';`,
      `export default withNativeFederation({`,
      `  name: 'mappings',`,
      `  exposes: { './deep': './src/deep.ts' },`,
      `  shared: {},`,
      `  sharedMappings: ['@fixture/kit'],`,
      `});`,
      '',
    ].join('\n')
  );

  // An expose reading a user define and using syntax a lower target has to transpile away.
  write(
    'src/defined.ts',
    [
      `export { pick } from 'modern-dep';`,
      `declare const BUILD_ID: string;`,
      `export const info = (o?: { id?: string }) => (o?.id ?? BUILD_ID) + '<DEFINED>';`,
      '',
    ].join('\n')
  );
  // A shared npm package the expose above imports: gets target and sourcemap, but not define
  // (native-federation-core#152). Unimported shared packages are dropped from the build.
  write(
    'node_modules/modern-dep/package.json',
    JSON.stringify({ name: 'modern-dep', version: '2.0.0', type: 'module', exports: './index.js' })
  );
  write(
    'node_modules/modern-dep/index.js',
    `export const pick = o => (o?.id ?? BUILD_ID) + '<MODERN>';\n`
  );
  write(
    'federation.passthrough.config.mjs',
    [
      `import { withNativeFederation, share } from '@softarc/native-federation/config';`,
      `export default withNativeFederation({`,
      `  name: 'passthrough',`,
      `  exposes: { './defined': './src/defined.ts' },`,
      `  shared: share({ 'modern-dep': { singleton: true, requiredVersion: 'auto' } }),`,
      `});`,
      '',
    ].join('\n')
  );

  // A shared package that is npm-linked: node_modules holds a symlink to a checkout outside it.
  write(
    'checkouts/linked-dep/package.json',
    JSON.stringify({ name: 'linked-dep', version: '1.0.0', type: 'module', exports: './index.js' })
  );
  write('checkouts/linked-dep/index.js', `export const linked = () => '<LINKED>';\n`);
  fs.symlinkSync(
    path.join(root, 'checkouts/linked-dep'),
    path.join(root, 'node_modules/linked-dep'),
    'junction'
  );
  write(
    'src/watched.ts',
    [
      `import { linked } from 'linked-dep';`,
      `import { button } from '@fixture/ui';`,
      `export const render = () => button(linked());`,
      '',
    ].join('\n')
  );
  write(
    'federation.watch.config.mjs',
    [
      `import { withNativeFederation, share } from '@softarc/native-federation/config';`,
      `export default withNativeFederation({`,
      `  name: 'watched',`,
      `  exposes: { './watched': './src/watched.ts' },`,
      `  shared: share({ 'linked-dep': { singleton: true, requiredVersion: 'auto' } }),`,
      `  sharedMappings: ['@fixture/ui'],`,
      `});`,
      '',
    ].join('\n')
  );

  // federation.config.mjs imports core; link the adapter's copy so it resolves from the tmp dir.
  const require = createRequire(import.meta.url);
  const corePkg = path.dirname(require.resolve('@softarc/native-federation/package.json'));
  fs.mkdirSync(path.join(root, 'node_modules/@softarc'), { recursive: true });
  fs.symlinkSync(corePkg, path.join(root, 'node_modules/@softarc/native-federation'), 'junction');
}

describe('runEsBuildBuilder', () => {
  let root: string;
  let originalCwd: string;

  let runEsBuildBuilder: typeof BuilderModule.runEsBuildBuilder;

  beforeAll(async () => {
    originalCwd = process.cwd();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-esbuild-')));
    createFixture(root);
    // core finds the root tsconfig from cwd and esbuild pins cwd as its working dir when first
    // loaded, so chdir before importing the builder (vitest isolates modules per spec file).
    process.chdir(root);
    ({ runEsBuildBuilder } = await import('./builder.js'));
  });

  afterAll(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('builds shared deps, shared mappings and exposed modules into remoteEntry.json', async () => {
    const builder = await runEsBuildBuilder('federation.config.mjs', {
      workspaceRoot: root,
      outputPath: 'dist',
      cachePath: 'node_modules/.cache/nf',
      tsConfig: 'tsconfig.json',
      adapterConfig: { plugins: [], frameworks: [] },
    });
    await builder.close();

    const outDir = path.join(root, 'dist');
    const remoteEntry = JSON.parse(
      fs.readFileSync(path.join(outDir, 'remoteEntry.json'), 'utf-8')
    ) as FederationInfo;
    // denseExternals is off, so every shared entry is a plain SharedInfo.
    const shared = remoteEntry.shared as SharedInfo[];

    expect(remoteEntry.name).toBe('fixture');

    const tinyDep = shared.find(s => s.packageName === 'tiny-dep');
    expect(tinyDep).toMatchObject({ singleton: true, strictVersion: true, version: '1.2.3' });
    expect(fs.existsSync(path.join(outDir, tinyDep!.outFileName))).toBe(true);

    const ui = shared.find(s => s.packageName === '@fixture/ui');
    expect(ui).toBeDefined();
    expect(fs.readFileSync(path.join(outDir, ui!.outFileName), 'utf-8')).toContain('[');

    expect(remoteEntry.exposes).toHaveLength(1);
    const [exposed] = remoteEntry.exposes;
    expect(exposed!.key).toBe('./component');

    // Shared deps and mappings must stay external to the exposed bundle.
    const exposedCode = fs.readFileSync(path.join(outDir, exposed!.outFileName), 'utf-8');
    expect(exposedCode).toMatch(/from\s*["']tiny-dep["']/);
    expect(exposedCode).toMatch(/from\s*["']@fixture\/ui["']/);
    expect(exposedCode).not.toContain('hello ');
  });

  const build = async (
    federationConfig: string,
    outputPath: string,
    adapterConfig: Partial<EsBuildAdapterConfig> = {}
  ) => {
    const builder = await runEsBuildBuilder(federationConfig, {
      workspaceRoot: root,
      outputPath,
      cachePath: `node_modules/.cache/${outputPath}`,
      tsConfig: 'tsconfig.json',
      adapterConfig: { plugins: [], frameworks: [], ...adapterConfig },
    });
    await builder.close();
    const outDir = path.join(root, outputPath);
    const remoteEntry = JSON.parse(
      fs.readFileSync(path.join(outDir, 'remoteEntry.json'), 'utf-8')
    ) as FederationInfo;
    const jsFiles = fs.readdirSync(outDir).filter(f => f.endsWith('.js'));
    return { outDir, remoteEntry, jsFiles };
  };

  it('inlines shared code into every expose when chunks is off', async () => {
    const { outDir, remoteEntry, jsFiles } = await build(
      'federation.no-chunks.config.mjs',
      'dist-no-chunks'
    );

    expect(remoteEntry.chunks).toBeUndefined();
    expect(jsFiles.sort()).toEqual(remoteEntry.exposes.map(e => e.outFileName).sort());
    for (const exposed of remoteEntry.exposes) {
      expect(fs.readFileSync(path.join(outDir, exposed.outFileName), 'utf-8')).toContain('!!!');
    }
  });

  it('splits shared code into a chunk that remoteEntry.json lists when chunks is on', async () => {
    const { outDir, remoteEntry, jsFiles } = await build(
      'federation.chunks.config.mjs',
      'dist-chunks'
    );

    // 'mapping-or-exposed' is core's bundle name for the exposes build.
    const chunks = remoteEntry.chunks?.['mapping-or-exposed'];
    expect(chunks).toHaveLength(1);
    const [chunk] = chunks!;
    expect(jsFiles).toContain(chunk);
    expect(fs.readFileSync(path.join(outDir, chunk!), 'utf-8')).toContain('!!!');

    // Core rewrites the bundler's './chunk-x.js' import to the import-map key for the chunk.
    const chunkImport = '@nf-internal/' + chunk!.replace(/\.js$/, '');
    for (const exposed of remoteEntry.exposes) {
      const code = fs.readFileSync(path.join(outDir, exposed.outFileName), 'utf-8');
      expect(code).not.toContain('!!!');
      expect(code).toContain(chunkImport);
    }
  });

  it('rewrites a relative import into a shared mapping to the mapping specifier', async () => {
    const { outDir, remoteEntry } = await build('federation.mappings.config.mjs', 'dist-mappings');

    const kit = (remoteEntry.shared as SharedInfo[]).find(s => s.packageName === '@fixture/kit');
    expect(fs.readFileSync(path.join(outDir, kit!.outFileName), 'utf-8')).toContain('<KIT_BUTTON>');

    const [exposed] = remoteEntry.exposes;
    const code = fs.readFileSync(path.join(outDir, exposed!.outFileName), 'utf-8');
    expect(code).not.toContain('<KIT_BUTTON>');
    expect(code).toMatch(/from\s*["']@fixture\/kit["']/);
    expect(code).not.toContain('libs/kit');
    // The barrel doesn't publish internal.ts, so rewriting would import a name that isn't there.
    expect(code).toContain('<KIT_INTERNAL>');
  });

  it('passes define, target and sourcemap through to the exposes build', async () => {
    const { outDir, remoteEntry } = await build('federation.passthrough.config.mjs', 'dist-pass', {
      define: { BUILD_ID: '"build-42"' },
      target: 'es2019',
      sourcemap: true,
    });

    const [exposed] = remoteEntry.exposes;
    const code = fs.readFileSync(path.join(outDir, exposed!.outFileName), 'utf-8');
    expect(code).toContain('build-42');
    expect(code).not.toContain('BUILD_ID');
    // es2019 predates optional chaining and nullish coalescing.
    expect(code).not.toContain('?.');
    expect(code).not.toContain('??');
    // A prod build has no source maps unless asked for.
    expect(fs.existsSync(path.join(outDir, exposed!.outFileName + '.map'))).toBe(true);
  });

  it('passes target and sourcemap, but not define, through to shared npm packages', async () => {
    const { outDir, remoteEntry } = await build(
      'federation.passthrough.config.mjs',
      'dist-pass-shared',
      {
        define: { BUILD_ID: '"build-42"' },
        target: 'es2019',
        sourcemap: true,
      }
    );

    const modernDep = (remoteEntry.shared as SharedInfo[]).find(
      s => s.packageName === 'modern-dep'
    );
    const code = fs.readFileSync(path.join(outDir, modernDep!.outFileName), 'utf-8');
    expect(code).toContain('<MODERN>');
    expect(code).not.toContain('?.');
    expect(code).not.toContain('??');
    // The externals cache key can't see define, so it must not leak into the shared bundle.
    expect(code).toContain('BUILD_ID');
    expect(code).not.toContain('build-42');
    // Core hashes the entry's name after bundling but leaves its map under the pre-hash name, so
    // follow the link rather than assuming `<outFileName>.map`.
    const mapFile = /\/\/# sourceMappingURL=(\S+)/.exec(code)?.[1];
    expect(mapFile).toBeDefined();
    expect(fs.existsSync(path.join(outDir, mapFile!))).toBe(true);
  });

  it('keeps the defaults when no passthroughs are set', async () => {
    const { outDir, remoteEntry } = await build(
      'federation.passthrough.config.mjs',
      'dist-pass-defaults'
    );

    const [exposed] = remoteEntry.exposes;
    const code = fs.readFileSync(path.join(outDir, exposed!.outFileName), 'utf-8');
    expect(code).toContain('??');
    expect(fs.existsSync(path.join(outDir, exposed!.outFileName + '.map'))).toBe(false);
  });

  describe('watch mode', () => {
    let rebuildForFederation: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      rebuildForFederation = vi.mocked(
        (await import('@softarc/native-federation')).rebuildForFederation
      );
    });

    beforeEach(() => {
      fakeWatcher.options = undefined;
      fakeWatcher.added = [];
      rebuildForFederation.mockClear();
    });

    const watch = (options: Partial<BuilderModule.EsBuildBuilder['options']> = {}) =>
      runEsBuildBuilder('federation.watch.config.mjs', {
        workspaceRoot: root,
        outputPath: 'dist-watch',
        cachePath: 'node_modules/.cache/nf',
        tsConfig: 'tsconfig.json',
        adapterConfig: { plugins: [], frameworks: [] },
        watch: true,
        rebuildDelay: 0,
        ...options,
      });

    const change = (file: string) => fakeWatcher.options!.onChange!(file);
    const watched = (poll: boolean) =>
      fakeWatcher.added.filter(a => a.poll === poll).flatMap(a => a.paths);
    const posix = (p: string) => p.split(path.sep).join('/');

    it('watches the shared-mapping dirs and rebuilds for a file added there', async () => {
      const builder = await watch();
      try {
        expect(watched(false)).toContain(posix(path.join(root, 'libs/ui')));

        const added = posix(path.join(root, 'libs/ui/new-file.ts'));
        change(added);
        await vi.waitFor(() => expect(rebuildForFederation).toHaveBeenCalledTimes(1));
        expect(rebuildForFederation.mock.calls[0]![3]).toEqual([added]);
      } finally {
        await builder.close();
      }
    });

    it('ignores changes under the output path', async () => {
      const builder = await watch();
      try {
        change(posix(path.join(root, 'dist-watch/remoteEntry.json')));
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(rebuildForFederation).not.toHaveBeenCalled();
      } finally {
        await builder.close();
      }
    });

    it('polls linked shared packages and rebuilds when they change, with watchLinkedDeps', async () => {
      const builder = await watch({ watchLinkedDeps: true });
      try {
        const linkedDir = posix(path.join(root, 'checkouts/linked-dep'));
        expect(watched(true)).toEqual([linkedDir]);

        change(`${linkedDir}/index.js`);
        await vi.waitFor(() => expect(rebuildForFederation).toHaveBeenCalledTimes(1));
        expect(rebuildForFederation.mock.calls[0]![3]).toEqual([`${linkedDir}/index.js`]);
      } finally {
        await builder.close();
      }
    });

    it('leaves linked shared packages unwatched by default', async () => {
      const builder = await watch();
      try {
        expect(watched(true)).toEqual([]);
      } finally {
        await builder.close();
      }
    });

    it('hands a custom watch port to the file watcher', async () => {
      const watcher = vi.fn();
      const builder = await watch({ watcher });
      try {
        expect(fakeWatcher.options!.watch).toBe(watcher);
      } finally {
        await builder.close();
      }
    });
  });
});
