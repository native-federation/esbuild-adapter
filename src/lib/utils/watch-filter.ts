import * as path from 'path';
import { isUnderDir } from '@softarc/native-federation/internal';

export interface ChangeFilterOptions {
  workspaceRoot: string;
  outputPath: string;
  cachePath: string;
}

// Rebuilds write to these dirs, so watching them would loop (ng #112).
export function createChangeFilter(options: ChangeFilterOptions): (changedPath: string) => boolean {
  const ignoredDirs = [
    path.resolve(options.workspaceRoot, options.outputPath),
    // Exposes land relative to cwd until native-federation-core#156.
    path.resolve(options.outputPath),
    path.resolve(options.workspaceRoot, options.cachePath),
  ];

  return changedPath => {
    const file = path.resolve(changedPath);
    return inNodeModules(file) || ignoredDirs.some(dir => isUnderDir(file, dir));
  };
}

const inNodeModules = (file: string) => file.split(/[\\/]/).includes('node_modules');

// Watching the root recursively would walk node_modules; its files get watched singly after a build.
export function mappingWatchDirs(dirs: string[], workspaceRoot: string): string[] {
  return dirs.filter(dir => !isUnderDir(workspaceRoot, dir));
}
