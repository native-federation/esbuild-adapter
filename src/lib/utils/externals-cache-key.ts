import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import type { ExternalsCacheKey } from '@softarc/native-federation/domain';
import type { EsBuildAdapterConfig } from '../domain/adapter-config.contract.js';
import { resolveFrameworkConfig } from '../core/resolve-framework-config.js';
import {
  nodeModulesBuildOptions,
  NODE_MODULES_RESOLVE_EXTENSIONS,
} from './node-modules-bundler.js';

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

// Keyed on the adapter-derived npm bundle options for both modes, so any new option reaches the
// key by default. Plugins can only be keyed by name: JSON drops their setup functions.
export function createExternalsCacheKey(
  config: EsBuildAdapterConfig,
  versions: KeyedVersions = readKeyedVersions()
): ExternalsCacheKey {
  const optionsFor = (dev: boolean) =>
    stableStringify(
      nodeModulesBuildOptions(
        resolveFrameworkConfig(config, dev, NODE_MODULES_RESOLVE_EXTENSIONS),
        dev
      )
    );

  return {
    adapter: versions.adapter,
    options: { esbuild: versions.esbuild, dev: optionsFor(true), prod: optionsFor(false) },
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, sortKeys((value as Record<string, unknown>)[key])])
  );
}
