import type * as esbuild from 'esbuild';
import type {
  EsBuildAdapterConfig,
  ReplacementConfig,
} from '../domain/adapter-config.contract.js';

export interface ResolvedFrameworkConfig {
  plugins: esbuild.Plugin[];
  fileReplacements?: Record<string, string | ReplacementConfig>;
  loader?: Record<string, esbuild.Loader>;
  resolveExtensions: string[];
  needsCommonJsPlugin: boolean;
}

export function resolveFrameworkConfig(
  config: EsBuildAdapterConfig,
  dev: boolean,
  defaultResolveExtensions: string[]
): ResolvedFrameworkConfig {
  const frameworks = config.frameworks ?? [];

  const frameworkReplacements: Record<string, string | ReplacementConfig> = {};
  const frameworkLoader: Record<string, esbuild.Loader> = {};
  const frameworkExtensions: string[] = [];
  const frameworkPlugins: esbuild.Plugin[] = [];
  let needsCommonJsPlugin = false;

  for (const fw of frameworks) {
    const modeReplacements = dev ? fw.fileReplacements?.dev : fw.fileReplacements?.prod;
    if (modeReplacements) Object.assign(frameworkReplacements, modeReplacements);
    if (fw.loader) Object.assign(frameworkLoader, fw.loader);
    if (fw.resolveExtensions) frameworkExtensions.push(...fw.resolveExtensions);
    if (fw.esbuildPlugins) frameworkPlugins.push(...fw.esbuildPlugins);
    if (fw.needsCommonJsPlugin) needsCommonJsPlugin = true;
  }

  const mergedReplacements: Record<string, string | ReplacementConfig> = {
    ...frameworkReplacements,
    ...(config.fileReplacements ?? {}),
  };

  const mergedLoader: Record<string, esbuild.Loader> = {
    ...frameworkLoader,
    ...(config.loader ?? {}),
  };

  const mergedExtensions = [
    ...defaultResolveExtensions,
    ...frameworkExtensions.filter(ext => !defaultResolveExtensions.includes(ext)),
  ];

  return {
    plugins: [...frameworkPlugins, ...config.plugins],
    fileReplacements: Object.keys(mergedReplacements).length ? mergedReplacements : undefined,
    loader: Object.keys(mergedLoader).length ? mergedLoader : undefined,
    resolveExtensions: mergedExtensions,
    needsCommonJsPlugin,
  };
}
