import * as fs from 'fs';
import * as path from 'path';

// Windows reports a directory under whatever drive-letter case the caller used. Only adopt the
// on-disk spelling when it differs by case alone: realpath also resolves symlinks, which would
// move npm-linked and pnpm workspaces off the path they were handed. Mirrors core's `toDiskCase`.
export function toDiskCase(p: string): string {
  let real: string;
  try {
    // Plain `realpathSync` keeps the caller's casing; only the native variant reports the disk's.
    real = fs.realpathSync.native(p);
  } catch {
    return p;
  }

  if (real === p || !differsOnlyByCase(real, p)) return p;
  return path.normalize(real);
}

const strip = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

function differsOnlyByCase(a: string, b: string): boolean {
  return strip(a) === strip(b);
}
