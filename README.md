# @softarc/native-federation-esbuild

[![npm version](https://img.shields.io/npm/v/@softarc/native-federation-esbuild)](https://www.npmjs.com/package/@softarc/native-federation-esbuild)
[![npm downloads](https://img.shields.io/npm/dm/@softarc/native-federation-esbuild)](https://www.npmjs.com/package/@softarc/native-federation-esbuild)
[![license](https://img.shields.io/npm/l/@softarc/native-federation-esbuild)](https://github.com/native-federation/esbuild-adapter/blob/main/LICENSE.md)

The esbuild adapter for **Native Federation**: the mental model of Module Federation, implemented on browser standards (ES modules and import maps) for Micro Frontends and plugin-based architectures.

📖 **[Documentation](https://native-federation.com/docs/v4/adapters/esbuild/)**

> [!NOTE]
> This is **v4**. Upgrading? See the [migration guide](https://native-federation.com/docs/v4/migration/). On Angular? Use the [Angular adapter](https://native-federation.com/docs/v4/angular-adapter/) instead.

## Features

- **Framework-agnostic** — plugs the [core builder](https://native-federation.com/docs/v4/core/) into esbuild for React, Preact, Lit or plain TypeScript; no CLI wrapper or framework coupling.
- **Framework presets** — per-framework esbuild settings (file replacements, loaders, `resolveExtensions`, CommonJS interop) as plugins. A React preset ships built-in.
- **CommonJS just works** — shared CJS dependencies go through `@chialab/esbuild-plugin-commonjs` when a preset asks for it.
- **Watch mode** — a debounced, cancellable rebuild queue that only re-bundles what changed.

## Quick start

Install the adapter next to its peer dependency, core:

```bash
npm i -D @softarc/native-federation @softarc/native-federation-esbuild
```

Describe what the application shares and exposes in `federation.config.mjs`:

```js
import { withNativeFederation, shareAll } from '@softarc/native-federation/config';
import { REACT_SKIP_LIST } from '@softarc/native-federation-esbuild/frameworks/react';

export default withNativeFederation({
  name: 'mfe1',
  exposes: { './component': './src/component.tsx' },
  shared: shareAll(
    { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    { skipList: REACT_SKIP_LIST }
  ),
});
```

Then drive the build from a small script:

```js
import { runEsBuildBuilder } from '@softarc/native-federation-esbuild';

const dev = process.argv.includes('--dev');

const federation = await runEsBuildBuilder('federation.config.mjs', {
  outputPath: 'dist',
  tsConfig: 'tsconfig.json',
  entryPoints: ['src/component.tsx'],
  dev,
  watch: dev,
});

if (!dev) await federation.close();
```

The resulting `remoteEntry.json` is loaded at runtime by the [orchestrator](https://native-federation.com/docs/v4/orchestrator/). The [Getting Started](https://native-federation.com/docs/v4/adapters/esbuild/getting-started/) guide walks through a complete React remote and host page, and the [playground](https://github.com/native-federation/playground) has runnable examples.

## Documentation

- [Builder](https://native-federation.com/docs/v4/adapters/esbuild/builder/) — `runEsBuildBuilder`, every `EsBuildBuilderOptions` field and the lower-level `createEsBuildAdapter`
- [Adapter configuration](https://native-federation.com/docs/v4/adapters/esbuild/configuration/) — esbuild `plugins`, `frameworks` presets, `fileReplacements` and `loader`
- [React & CommonJS interop](https://native-federation.com/docs/v4/adapters/esbuild/react-interop/) — the React preset, the CJS plugin and the Shadow-DOM custom-element pattern
- [Core configuration](https://native-federation.com/docs/v4/core/configuration/) and [sharing dependencies](https://native-federation.com/docs/v4/core/sharing/)
- [Mental model](https://native-federation.com/docs/v4/mental-model/)
- [FAQ](https://native-federation.com/docs/v4/faq/)

Using an AI coding assistant? Point it at [`llms.txt`](https://native-federation.com/llms.txt).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](https://github.com/native-federation/esbuild-adapter/blob/main/CONTRIBUTING.md).

## Credits

Big thanks to [Zack Jackson](https://twitter.com/ScriptedAlchemy) for originally coming up with Module Federation and its mental model, and to [Florian Rappl](https://twitter.com/FlorianRappl) and the [Angular Architects team](https://www.angulararchitects.io/en/) for their feedback and contributions. Find the current team behind native-federation on our [documentation website](https://native-federation.com/team/).

## License

[MIT](https://github.com/native-federation/esbuild-adapter/blob/main/LICENSE.md)
