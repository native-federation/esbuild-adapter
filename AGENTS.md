# Native Federation esbuild adapter - AI Assistant Guide

## Project Overview

`@softarc/native-federation-esbuild` is the esbuild build adapter for
[Native Federation](https://github.com/native-federation/native-federation-core). Core
(`@softarc/native-federation`) owns the federation logic — config normalization, externals,
`remoteEntry.json`, caching — and delegates the actual bundling to an `NFBuildAdapter`. This
package implements that adapter on top of esbuild and ships a small builder (`runEsBuildBuilder`)
that wires it into core's build / watch loop.

## Repository Structure

A **single-package repository**, published from the root.

```
/
├── package.json          → @softarc/native-federation-esbuild (exports → ./dist/*)
├── esbuild.config.mjs    → raw esbuild build (1:1 transpile, bundle: false)
├── tsconfig.json         → base compiler options
├── tsconfig.build.json   → emitDeclarationOnly → dist
├── tsconfig.spec.json    → test typings
├── eslint.config.mts
├── knip.json
├── vite.config.ts        → vitest config
├── src/                  → library source
└── dist/                 → build output (gitignored)
```

### Scripts

- `pnpm build` → `node esbuild.config.mjs` (transpiles every `src/**/*.ts` to a mirrored
  `dist/**/*.js`) then `tsc -p tsconfig.build.json` (emits the matching `.d.ts` files).
- `pnpm typecheck` → type-checks the sources and the specs.
- `pnpm lint` → `eslint src`.
- `pnpm knip` → unused files, exports and dependencies.
- `pnpm test` → `vitest`.

### Package exports

- `.` - `createEsBuildAdapter`, `runEsBuildBuilder`, `normalizeBuilderOptions`, framework presets
- `./domain` - contracts (`EsBuildAdapterConfig`, `EsBuildBuilderOptions`, `NfFrameworkPlugin`, ...)
- `./frameworks/react` - the React preset

**Important files**:

- `src/lib/core/esbuild-adapter.ts` - the `NFBuildAdapter`: one esbuild context per bundle name
- `src/lib/core/builder.ts` - `runEsBuildBuilder`: build, then optionally watch and rebuild
- `src/lib/core/resolve-framework-config.ts` - merges framework plugins with the user config
- `src/lib/utils/source-code-bundler.ts` - context for exposed modules and shared mappings
- `src/lib/utils/node-modules-bundler.ts` - context for shared npm packages

## Conventions

- ESM only; **always use `.js` extensions** in relative imports.
- Contracts live in `src/lib/domain/*.contract.ts` and are re-exported from `src/domain.ts`.
- Specs live next to the source as `*.spec.ts`.
- Comments are fine but be very conservative. Only comment what's really important (the why).
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`); keep PRs focused.

## Version Management

The version lives in the root `package.json`. Release: update the version, `pnpm build`, publish
from the root (`files: ["dist"]`).
