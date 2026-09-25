import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PathToImport } from '@softarc/native-federation/internal';
import type { OnResolveArgs, OnResolveOptions, PluginBuild } from 'esbuild';
import { createSharedMappingsPlugin } from './shared-mappings-plugin.js';

type ResolveHandler = (args: OnResolveArgs) => Promise<{ path?: string; external?: boolean }>;

/**
 * Ported from the angular-adapter's spec. Core's resolver reads the barrels off disk and compares
 * declarations, so the mappings have to point at real files holding real exports.
 *
 * - `foo` is a plain lib whose entry point is a non-index barrel.
 * - `foo-utils` only exists to share a path prefix with `foo`.
 * - `ui` re-exports two files and deliberately hides a third.
 * - `ui/lib/testing` is a secondary entry point nested under `ui`'s barrel.
 * - `renamed` re-exports under a different name than the class is declared with.
 */
let ws: string;

function write(relative: string, contents = ''): void {
  const file = path.join(ws, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

beforeAll(() => {
  ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-shared-mappings-')));

  write('libs/foo/src/public-api.ts', "export * from './lib/thing';\n");
  write('libs/foo/src/lib/thing.ts', 'export class Thing {}\n');
  write('libs/foo-utils/src/helper.ts', 'export class Helper {}\n');

  write('libs/ui/src/index.ts', "export * from './lib/button';\nexport * from './lib/badge';\n");
  write('libs/ui/src/lib/button.tsx', 'export const Button = () => null;\n');
  write('libs/ui/src/lib/badge.ts', 'export class Badge {}\n');
  write('libs/ui/src/lib/hidden.ts', 'export class Hidden {}\n');
  write('libs/ui/src/lib/testing/index.ts', "export * from './harness';\n");
  write('libs/ui/src/lib/testing/harness.ts', 'export class Harness {}\n');

  write('libs/renamed/src/index.ts', "export { Badge as RenamedBadge } from './lib/badge';\n");
  write('libs/renamed/src/lib/badge.ts', 'export class Badge {}\n');

  write('apps/app/src/main.ts');
});

afterAll(() => fs.rmSync(ws, { recursive: true, force: true }));

function setupPlugin(mappedPaths: PathToImport): {
  options?: OnResolveOptions;
  handler?: ResolveHandler;
  start?: () => void;
} {
  const plugin = createSharedMappingsPlugin(mappedPaths);

  let options: OnResolveOptions | undefined;
  let handler: ResolveHandler | undefined;
  let start: (() => void) | undefined;
  const build = {
    initialOptions: {},
    onStart(cb: () => void) {
      start = cb;
    },
    onResolve(opts: OnResolveOptions, cb: ResolveHandler) {
      options = opts;
      handler = cb;
    },
  } as unknown as PluginBuild;

  plugin.setup(build);
  return { options, handler, start };
}

const foo = (): PathToImport => ({ [path.join(ws, 'libs/foo/src/public-api.ts')]: 'foo-remote' });

const ui = (): PathToImport => ({
  [path.join(ws, 'libs/ui/src/index.ts')]: '@myorg/ui',
  [path.join(ws, 'libs/ui/src/lib/testing/index.ts')]: '@myorg/ui/testing',
});

function resolve(
  handler: ResolveHandler,
  args: { from: string; import: string; kind?: OnResolveArgs['kind']; namespace?: string }
) {
  const importer = path.join(ws, args.from);

  return handler({
    kind: args.kind ?? 'import-statement',
    namespace: args.namespace ?? 'file',
    resolveDir: path.dirname(importer),
    path: args.import,
    importer,
  } as OnResolveArgs);
}

describe('createSharedMappingsPlugin', () => {
  it('registers an onResolve handler for relative imports', () => {
    const { options } = setupPlugin(foo());
    expect(options?.filter).toEqual(/^[.]/);
  });

  it('maps a relative import pointing into a shared lib to an external path', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/foo/src/lib/thing',
    });

    expect(result).toEqual({ path: 'foo-remote', external: true });
  });

  it('maps a relative import of the mapped entry point itself', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/foo/src/public-api',
    });

    expect(result).toEqual({ path: 'foo-remote', external: true });
  });

  it('maps a .tsx file the barrel re-exports', async () => {
    const { handler } = setupPlugin(ui());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/ui/src/lib/button',
    });

    expect(result).toEqual({ path: '@myorg/ui', external: true });
  });

  it('does not externalize imports originating from within the same lib (self-import)', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'libs/foo/src/lib/other.ts',
      import: './thing',
    });

    expect(result).toEqual({});
  });

  it('ignores non-import-statement kinds', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/foo/src/lib/thing',
      kind: 'require-call',
    });

    expect(result).toEqual({});
  });

  // Another plugin's virtual namespace has no file on disk behind resolveDir.
  it('ignores imports outside the file namespace', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/foo/src/lib/thing',
      namespace: 'virtual',
    });

    expect(result).toEqual({});
  });

  it('returns an empty result for unmapped relative imports', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: './local-file',
    });

    expect(result).toEqual({});
  });

  it('leaves a sibling lib whose path merely shares a prefix alone', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/foo-utils/src/helper',
    });

    expect(result).toEqual({});
  });

  it('leaves a file the barrel does not re-export inlined', async () => {
    const { handler } = setupPlugin(ui());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/ui/src/lib/hidden',
    });

    expect(result).toEqual({});
  });

  // The rewrite swaps the specifier but keeps the imported name, so a renamed re-export would
  // leave `Badge` undefined on the mapping's namespace.
  it('declines a file the barrel re-exports under a different name', async () => {
    const { handler } = setupPlugin({
      [path.join(ws, 'libs/renamed/src/index.ts')]: '@myorg/renamed',
    });

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/renamed/src/lib/badge',
    });

    expect(result).toEqual({});
  });

  it('prefers the closest mapping when a secondary entry point sits under a barrel', async () => {
    const { handler } = setupPlugin(ui());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/ui/src/lib/testing/harness',
    });

    expect(result).toEqual({ path: '@myorg/ui/testing', external: true });
  });

  it('externalizes a barrel file reaching into a secondary of the same lib', async () => {
    const { handler } = setupPlugin(ui());

    const result = await resolve(handler!, {
      from: 'libs/ui/src/lib/badge.ts',
      import: './testing/harness',
    });

    expect(result).toEqual({ path: '@myorg/ui/testing', external: true });
  });

  // Export surfaces are cached for the resolver's lifetime and an esbuild context outlives any
  // one rebuild, so without the onStart reset an edited barrel would keep answering from the
  // first build until the watcher restarts.
  it('picks up a barrel edited between rebuilds', async () => {
    write('libs/watched/src/index.ts', "export * from './lib/a';\n");
    write('libs/watched/src/lib/a.ts', 'export class A {}\n');
    write('libs/watched/src/lib/b.ts', 'export class B {}\n');

    const { handler, start } = setupPlugin({
      [path.join(ws, 'libs/watched/src/index.ts')]: '@myorg/watched',
    });

    const deepImport = { from: 'apps/app/src/main.ts', import: '../../../libs/watched/src/lib/b' };

    expect(await resolve(handler!, deepImport)).toEqual({});

    write('libs/watched/src/index.ts', "export * from './lib/a';\nexport * from './lib/b';\n");
    start!();

    expect(await resolve(handler!, deepImport)).toEqual({ path: '@myorg/watched', external: true });
  });
});
