import * as path from 'path';
import { createChangeFilter, mappingWatchDirs } from './watch-filter.js';

// A workspace root that is deliberately not cwd, the case a cwd-relative resolve gets wrong.
const root = path.resolve('/tmp/nf-watch-filter/ws');
const at = (...segments: string[]) =>
  path
    .join(root, ...segments)
    .split(path.sep)
    .join('/');

describe('createChangeFilter', () => {
  const isIgnored = createChangeFilter({
    workspaceRoot: root,
    outputPath: 'dist/app',
    cachePath: path.join(root, '.nf-cache'),
  });

  it('ignores the output path resolved against the workspace root, not cwd', () => {
    expect(isIgnored(at('dist/app/remoteEntry.json'))).toBe(true);
    expect(isIgnored(at('dist/app'))).toBe(true);
  });

  // Core passes the exposes build the raw outputPath, so its files end up under cwd.
  it('also ignores the output path resolved against cwd', () => {
    expect(isIgnored(path.resolve('dist/app/component.js'))).toBe(true);
  });

  it('accepts an absolute outputPath', () => {
    const filter = createChangeFilter({
      workspaceRoot: root,
      outputPath: path.join(root, 'out'),
      cachePath: path.join(root, '.nf-cache'),
    });
    expect(filter(at('out/remoteEntry.json'))).toBe(true);
  });

  it('does not ignore a sibling that only shares a prefix with the output path', () => {
    expect(isIgnored(at('dist/app-other/index.ts'))).toBe(false);
  });

  it('ignores a cache path outside node_modules', () => {
    expect(isIgnored(at('.nf-cache/app/externals.json'))).toBe(true);
  });

  it('ignores anything under a node_modules dir', () => {
    expect(isIgnored(at('node_modules/.cache/nf/app/index.js'))).toBe(true);
    expect(isIgnored(at('libs/ui/node_modules/dep/index.js'))).toBe(true);
  });

  it('lets source changes through', () => {
    expect(isIgnored(at('libs/ui/index.ts'))).toBe(false);
    expect(isIgnored(at('src/component.ts'))).toBe(false);
  });

  it.runIf(process.platform === 'win32')('matches backslash paths on Windows', () => {
    expect(isIgnored(path.join(root, 'dist', 'app', 'remoteEntry.json'))).toBe(true);
    expect(isIgnored(path.join(root, 'libs', 'ui', 'index.ts'))).toBe(false);
  });
});

describe('mappingWatchDirs', () => {
  it('keeps mapping dirs inside the workspace', () => {
    expect(mappingWatchDirs([at('libs/ui'), at('libs/kit/src')], root)).toEqual([
      at('libs/ui'),
      at('libs/kit/src'),
    ]);
  });

  // e.g. `"@app/env": ["env.ts"]`: its dirname is the workspace root itself.
  it('drops the workspace root', () => {
    expect(mappingWatchDirs([at(), at('libs/ui')], root)).toEqual([at('libs/ui')]);
  });

  // A mapping into a monorepo root above an app's workspace root.
  it('drops a dir above the workspace root', () => {
    const above = path.dirname(root).split(path.sep).join('/');
    expect(mappingWatchDirs([above], root)).toEqual([]);
  });

  it('keeps a dir outside the workspace that does not contain it', () => {
    const sibling = path.resolve(root, '../shared').split(path.sep).join('/');
    expect(mappingWatchDirs([sibling], root)).toEqual([sibling]);
  });
});
