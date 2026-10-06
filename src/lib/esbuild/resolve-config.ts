import type * as esbuild from 'esbuild';
import type { EsBuildAdapterConfig, ReplacementConfig } from '../domain/adapter-config.contract.js';

export interface ResolvedAdapterConfig {
  plugins: esbuild.Plugin[];
  loader?: Record<string, esbuild.Loader>;
  // Framework extensions, appended to each bundle kind's defaults.
  resolveExtensions: string[];
  fileReplacements: { dev: Record<string, string>; prod: Record<string, string> };
  define?: Record<string, string>;
  target?: string | string[];
  sourcemap?: esbuild.BuildOptions['sourcemap'];
  preserveSymlinks?: boolean;
}

// Framework presets go first, so user values override them.
export function resolveAdapterConfig(config: EsBuildAdapterConfig): ResolvedAdapterConfig {
  const frameworks = config.frameworks ?? [];

  const loader: Record<string, esbuild.Loader> = Object.assign(
    {},
    ...frameworks.map(fw => fw.loader),
    config.loader
  );
  const replacements = (mode: 'dev' | 'prod') =>
    mergeReplacements([
      ...frameworks.map(fw => fw.fileReplacements?.[mode]),
      config.fileReplacements,
    ]);

  return {
    plugins: [...frameworks.flatMap(fw => fw.esbuildPlugins ?? []), ...config.plugins],
    loader: Object.keys(loader).length ? loader : undefined,
    resolveExtensions: frameworks.flatMap(fw => fw.resolveExtensions ?? []),
    fileReplacements: { dev: replacements('dev'), prod: replacements('prod') },
    define: config.define,
    target: config.target,
    sourcemap: config.sourcemap,
    preserveSymlinks: config.preserveSymlinks,
  };
}

// A redefined key moves to the end: replaceSuffix lets the last matching key win, so an override
// also beats a different key that matches the same file.
function mergeReplacements(
  sources: (Record<string, string | ReplacementConfig> | undefined)[]
): Record<string, string> {
  const merged = new Map<string, string>();
  for (const [from, to] of sources.flatMap(source => Object.entries(source ?? {}))) {
    merged.delete(from);
    merged.set(from, typeof to === 'string' ? to : to.file);
  }
  return Object.fromEntries(merged);
}
