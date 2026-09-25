import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import type { FederationInfo, SharedInfo } from '@softarc/native-federation';
import type * as BuilderModule from './builder.js';

// Minimal workspace: one shared npm package, one exposed module and one tsconfig path mapping.
function createFixture(root: string): void {
  const write = (file: string, content: string) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  write(
    'package.json',
    JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { 'tiny-dep': '1.2.3' } })
  );
  write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        target: 'es2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        paths: { '@fixture/ui': ['./libs/ui/index.ts'] },
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

  const build = async (federationConfig: string, outputPath: string) => {
    const builder = await runEsBuildBuilder(federationConfig, {
      workspaceRoot: root,
      outputPath,
      cachePath: `node_modules/.cache/${outputPath}`,
      tsConfig: 'tsconfig.json',
      adapterConfig: { plugins: [], frameworks: [] },
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
});
