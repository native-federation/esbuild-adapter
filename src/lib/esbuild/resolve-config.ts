import type * as esbuild from 'esbuild';
import type { EsBuildAdapterConfig, ReplacementConfig } from '../domain/adapter-config.contract.js';

export interface ResolvedAdapterConfig {
  plugins: esbuild.Plugin[];
  loader?: Record<string, esbuild.Loader>;
  // Framework extensions, appended to each bundle kind's defaults.
  resolveExtensions: string[];
  fileReplacements: { dev: Record<string, string>; prod: Record<string, string> };
  needsCommonJsPlugin: boolean;
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
    toFiles(
      Object.assign(
        {},
        ...frameworks.map(fw => fw.fileReplacements?.[mode]),
        config.fileReplacements
      )
    );

  return {
    plugins: [...frameworks.flatMap(fw => fw.esbuildPlugins ?? []), ...config.plugins],
    loader: Object.keys(loader).length ? loader : undefined,
    resolveExtensions: frameworks.flatMap(fw => fw.resolveExtensions ?? []),
    fileReplacements: { dev: replacements('dev'), prod: replacements('prod') },
    needsCommonJsPlugin: frameworks.some(fw => fw.needsCommonJsPlugin),
    define: config.define,
    target: config.target,
    sourcemap: config.sourcemap,
    preserveSymlinks: config.preserveSymlinks,
  };
}

function toFiles(replacements: Record<string, string | ReplacementConfig>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(replacements).map(([from, to]) => [from, typeof to === 'string' ? to : to.file])
  );
}
