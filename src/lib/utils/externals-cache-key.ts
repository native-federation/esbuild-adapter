import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import type { ExternalsCacheKey } from '@softarc/native-federation/domain';
import type { EsBuildAdapterConfig } from '../domain/adapter-config.contract.js';

export interface KeyedVersions {
  adapter: string;
  esbuild: string;
}

export function readKeyedVersions(): KeyedVersions {
  const require = createRequire(import.meta.url);
  // Self-reference through our own `exports`, so it doesn't depend on this file's location.
  const pkg = require('@softarc/native-federation-esbuild/package.json') as {
    name: string;
    version: string;
  };

  return {
    adapter: `${pkg.name}@${pkg.version}`,
    esbuild: esbuild.version,
  };
}

// Only options that reach the shared npm package bundles belong here; define and
// preserveSymlinks are applied to source code only (see node-modules-bundler.ts).
export function createExternalsCacheKey(
  config: Pick<EsBuildAdapterConfig, 'target' | 'sourcemap'>,
  versions: KeyedVersions = readKeyedVersions()
): ExternalsCacheKey {
  const options: Record<string, string | boolean> = { esbuild: versions.esbuild };

  if (config.target !== undefined) {
    options['target'] = [config.target].flat().sort().join(',');
  }
  if (config.sourcemap !== undefined) {
    options['sourcemap'] = config.sourcemap;
  }

  return { adapter: versions.adapter, options };
}
