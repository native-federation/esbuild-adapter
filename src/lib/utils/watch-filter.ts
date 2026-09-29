import * as path from 'path';
import { isUnderDir } from '@softarc/native-federation/internal';

export interface ChangeFilterOptions {
  workspaceRoot: string;
  outputPath: string;
  cachePath: string;
}

// Every rebuild writes to the output and cache dirs, so a watched dir containing one of them
// would otherwise rebuild in a loop (ng #112).
export function createChangeFilter(options: ChangeFilterOptions): (changedPath: string) => boolean {
  const ignoredDirs = [
    path.resolve(options.workspaceRoot, options.outputPath),
    // Core hands the exposes build the raw outputPath, so those files land relative to cwd.
    path.resolve(options.outputPath),
    path.resolve(options.workspaceRoot, options.cachePath),
  ];

  return changedPath => {
    // Relative paths come from esbuild's metafile, which is relative to cwd.
    const file = path.resolve(changedPath);
    return inNodeModules(file) || ignoredDirs.some(dir => isUnderDir(file, dir));
  };
}

const inNodeModules = (file: string) => file.split(/[\\/]/).includes('node_modules');

// A recursive watch on the workspace root (or above) would also walk node_modules. The mapping
// files there are still watched one by one once the first build has recorded its inputs.
export function mappingWatchDirs(dirs: string[], workspaceRoot: string): string[] {
  return dirs.filter(dir => !isUnderDir(workspaceRoot, dir));
}
