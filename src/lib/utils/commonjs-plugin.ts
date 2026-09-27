import type { Loader, Plugin } from 'esbuild';
import * as fs from 'fs';
import { isBuiltin } from 'module';
import * as path from 'path';

const REQUIRE_CALL = /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const REEXPORT =
  /(?:\bmodule\.exports\s*=|\b__exportStar\s*\(|\b__export\s*\()\s*require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;

// chialab's UMD sniffing drops the named exports of plain CJS files ending in a
// `typeof module === 'object'` check (quill-delta). esbuild's own interop handles those; it only
// falls short on require() of an external, which becomes a __require shim that throws in the
// browser. So only files that require an external are converted, plus the entry points, whose
// named exports it synthesizes when core's synthesizeCjsExports is off. A converted
// `module.exports = require('./x')` becomes `export * from './x'`, so ./x must be converted too.
export async function createScopedCommonJsPlugin(
  entryPoints: string[],
  external: string[]
): Promise<Plugin> {
  const cjs = await import('@chialab/cjs-to-esm');
  const matchesExternal = createExternalMatcher(external);

  return {
    name: 'commonjs',
    setup(build) {
      const { format, platform, sourcemap, sourcesContent, loader = {} } = build.initialOptions;
      if (format !== 'esm') return;

      // esbuild externalizes builtins on node without them being listed.
      const isExternal =
        platform === 'node'
          ? (specifier: string) => isBuiltin(specifier) || matchesExternal(specifier)
          : matchesExternal;
      // Core hands over entry points through node_modules symlinks (pnpm); onLoad sees realpaths.
      const scope = new Set(entryPoints.flatMap(file => withRealpath(path.resolve(file))));

      build.onLoad({ filter: /\.[cm]?js$/, namespace: 'file' }, async args => {
        const code = await fs.promises.readFile(args.path, 'utf-8');
        if (!scope.has(args.path) && !requiresAny(code, isExternal)) return undefined;

        for (const [, , specifier] of code.matchAll(REEXPORT)) {
          if (isExternal(specifier!)) continue;
          const resolved = await build.resolve(specifier!, {
            kind: 'require-call',
            resolveDir: path.dirname(args.path),
          });
          if (resolved.errors.length === 0 && resolved.path) scope.add(resolved.path);
        }

        const options = {
          sourcemap: !!sourcemap,
          source: args.path,
          sourcesContent: sourcesContent !== false,
        };
        const result = (await cjs.maybeMixedModule(code))
          ? await cjs.wrapDynamicRequire(code, options)
          : (await cjs.maybeCommonjsModule(code))
            ? await cjs.transform(code, options)
            : undefined;
        if (!result) return undefined;

        return {
          contents: result.map ? inlineSourcemap(result.code, result.map) : result.code,
          loader: (loader[path.extname(args.path)] ?? 'js') as Loader,
        };
      });
    },
  };
}

function withRealpath(file: string): string[] {
  try {
    return [file, fs.realpathSync(file)];
  } catch {
    return [file];
  }
}

function inlineSourcemap(code: string, map: unknown): string {
  const data = Buffer.from(JSON.stringify(map)).toString('base64');
  return `${code}\n//# sourceMappingURL=data:application/json;base64,${data}\n`;
}

function requiresAny(code: string, isExternal: (specifier: string) => boolean): boolean {
  if (!code.includes('require')) return false;
  for (const [, , specifier] of code.matchAll(REQUIRE_CALL)) {
    if (isExternal(specifier!)) return true;
  }
  return false;
}

// Mirrors esbuild's `external` matching: exact names, their subpaths, and `*` wildcards.
export function createExternalMatcher(external: string[]): (specifier: string) => boolean {
  const names = new Set(external.filter(ext => !ext.includes('*')));
  const wildcards = external
    .filter(ext => ext.includes('*'))
    .map(ext => new RegExp(`^${ext.split('*').map(escapeRegExp).join('.*')}$`));

  return specifier => {
    if (names.has(specifier) || wildcards.some(re => re.test(specifier))) return true;
    for (let i = specifier.indexOf('/'); i > 0; i = specifier.indexOf('/', i + 1)) {
      if (names.has(specifier.slice(0, i))) return true;
    }
    return false;
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
