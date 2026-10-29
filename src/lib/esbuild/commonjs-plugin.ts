import type { Plugin } from 'esbuild';
import { isBuiltin } from 'module';

const NAMESPACE = 'nf-cjs-external';
const ESM_PREFIX = 'esm:';

// esbuild turns a require() of an external into a __require shim that throws in the browser (and
// in ESM output on node). Each such require is routed to a CJS stub that gets the external through
// an ESM stub instead, so the import stays a real top-level import. Files are never converted, so
// everything else keeps esbuild's own CJS interop.
export function createCommonJsPlugin(external: string[]): Plugin {
  const matchesExternal = createExternalMatcher(external);

  return {
    name: 'commonjs',
    setup(build) {
      const { format, platform } = build.initialOptions;
      if (format !== 'esm') return;

      // esbuild externalizes builtins on node without them being listed.
      const isExternal =
        platform === 'node'
          ? (specifier: string) => isBuiltin(specifier) || matchesExternal(specifier)
          : matchesExternal;

      build.onResolve({ filter: /.*/ }, args => {
        if (args.namespace === NAMESPACE && args.path.startsWith(ESM_PREFIX)) {
          return { path: args.path, namespace: NAMESPACE };
        }
        if (args.kind !== 'require-call' || !isExternal(args.path)) return undefined;
        return { path: args.path, namespace: NAMESPACE };
      });

      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, args => {
        if (args.path.startsWith(ESM_PREFIX)) {
          const specifier = JSON.stringify(args.path.slice(ESM_PREFIX.length));
          return { contents: `import * as ns from ${specifier};\nexport { ns };\n`, loader: 'js' };
        }
        return {
          contents: `module.exports = (${TO_MODULE_EXPORTS})(require(${JSON.stringify(ESM_PREFIX + args.path)}).ns);\n`,
          loader: 'js',
        };
      });
    },
  };
}

// Core's synthesized CJS entries export `default` (the real module.exports) plus each of its keys
// as a named export; CJS callers get that default back. Any other namespace is returned as is, like
// Node's require() of an ES module.
const TO_MODULE_EXPORTS = `function (ns) {
  var value = ns.default;
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return ns;
  return Object.keys(ns).every(function (key) {
    return key === 'default' || ns[key] === value[key];
  }) ? value : ns;
}`;

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
