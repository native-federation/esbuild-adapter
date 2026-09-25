import type { Plugin, PluginBuild } from 'esbuild';
import * as path from 'path';
import {
  createMappingImportResolver,
  type PathToImport,
} from '@softarc/native-federation/internal';

// esbuild's `external` only matches the unresolved specifier, so a relative import reaching into
// a mapped lib would otherwise inline a second copy next to the federated one.
export function createSharedMappingsPlugin(sharedMappings: PathToImport): Plugin {
  const resolveMapping = createMappingImportResolver(sharedMappings);

  return {
    name: 'nf-shared-mappings',
    setup(build: PluginBuild) {
      // The context outlives every rebuild, so an edited barrel would keep answering from the
      // export surface cached on the first build.
      build.onStart(() => {
        resolveMapping.reset();
      });

      build.onResolve({ filter: /^[.]/ }, args => {
        if (args.kind !== 'import-statement' || args.namespace !== 'file') {
          return {};
        }

        // Unresolved: the resolver does its own extension and index resolution.
        const importName = resolveMapping(path.join(args.resolveDir, args.path), args.importer);

        return importName ? { path: importName, external: true } : {};
      });
    },
  };
}
