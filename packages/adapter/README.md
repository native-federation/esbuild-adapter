# native-federation-esbuild

As Native Federation is tooling agnostic, we need an adapter to make it work with specific build tools. This library contains such an adapter for esbuild.

## Examples

Find an example repository here: https://github.com/Aukevanoost/native-federation-examples-react/

## Framework plugins

The adapter is framework-agnostic. Framework-specific behaviour — file replacements (e.g. React's `cjs/*.development.js` vs `cjs/*.production.min.js`), esbuild plugins for non-JS sources, extra `resolveExtensions`, and the CommonJS interop plugin — is supplied through **framework plugins** that you pass to the adapter.

### Using the React preset

A React preset ships with the package. If you pass no `frameworks`, it is applied by default, so existing setups keep working unchanged:

```ts
import { createEsBuildAdapter } from '@softarc/native-federation-esbuild';
import { reactFrameworkPlugin } from '@softarc/native-federation-esbuild/frameworks/react';

createEsBuildAdapter({
  plugins: [],
  frameworks: [reactFrameworkPlugin()], // optional — same as the default
});
```

### Disabling all framework presets

Pass an empty array to opt out of all framework defaults (including React):

```ts
createEsBuildAdapter({
  plugins: [],
  frameworks: [],
});
```

### Writing a framework plugin

A framework plugin is a plain object implementing `NfFrameworkPlugin`:

```ts
import type { NfFrameworkPlugin } from '@softarc/native-federation-esbuild';
import vuePlugin from 'esbuild-plugin-vue3';

export function vueFrameworkPlugin(): NfFrameworkPlugin {
  return {
    name: 'vue',
    esbuildPlugins: [vuePlugin()],
    resolveExtensions: ['.vue'],
    // No CJS interop needed for Vue 3
    needsCommonJsPlugin: false,
  };
}
```

Pass it to the adapter the same way as React:

```ts
createEsBuildAdapter({
  plugins: [],
  frameworks: [vueFrameworkPlugin()],
});
```

You can combine multiple plugins; their contributions are merged, with your own top-level `EsBuildAdapterConfig` keys (`plugins`, `fileReplacements`, `compensateExports`, `loader`) taking precedence over what a plugin supplies.

### Plugin contract

| Field | Type | Purpose |
| --- | --- | --- |
| `name` | `string` | Identifier for the framework — useful for logs/debugging. |
| `fileReplacements` | `{ dev?, prod? }` | Maps of `<source path> → <replacement file>` applied to node-module entry points. The right map is picked automatically based on the build's `dev` flag. |
| `compensateExports` | `RegExp[]` | Patterns merged into `config.compensateExports`. |
| `resolveExtensions` | `string[]` | Extra esbuild `resolveExtensions` (e.g. `['.vue']`). Merged with the adapter's defaults. |
| `loader` | `Record<string, esbuild.Loader>` | Esbuild loader overrides. Merged with `config.loader`; user entries win. |
| `esbuildPlugins` | `esbuild.Plugin[]` | Framework-specific esbuild plugins (e.g. `esbuild-plugin-vue3`). Prepended to `config.plugins`. |
| `needsCommonJsPlugin` | `boolean` | Set to `true` when the framework's runtime ships CJS (React). Triggers the CommonJS interop plugin for the node-modules bundler. |

All fields except `name` are optional.
