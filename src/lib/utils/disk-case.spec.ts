import * as fs from 'fs';
import * as path from 'path';
import { toDiskCase } from './disk-case.js';

// An automock stubs realpathSync but not the `.native` property hanging off it.
vi.mock('fs', () => ({ realpathSync: { native: vi.fn() } }));

function mockNativeRealpath(impl: (p: string) => string): void {
  vi.mocked(fs.realpathSync.native).mockImplementation(impl as typeof fs.realpathSync.native);
}

describe('toDiskCase', () => {
  // The Windows case: the shell hands over `c:\…` while the filesystem stores `C:\…`.
  it('adopts the on-disk spelling when only the case differs', () => {
    mockNativeRealpath(() => 'C:\\ws\\project');

    expect(toDiskCase('c:\\ws\\project')).toBe(path.normalize('C:\\ws\\project'));
  });

  it('accepts a correction that also differs in separator style', () => {
    mockNativeRealpath(() => 'C:/ws/project');

    expect(toDiskCase('c:\\ws\\project')).toBe(path.normalize('C:/ws/project'));
  });

  it('ignores a trailing slash when deciding whether the paths are the same', () => {
    mockNativeRealpath(() => 'C:/ws/project');

    expect(toDiskCase('c:/ws/project/')).toBe(path.normalize('C:/ws/project'));
  });

  // npm-linked and pnpm setups resolve to a different directory entirely, not a re-cased one.
  it('keeps the input when realpath resolves to a different directory', () => {
    mockNativeRealpath(() => '/real/checkout');

    expect(toDiskCase('/links/project')).toBe('/links/project');
  });

  it('keeps the input when realpath throws', () => {
    mockNativeRealpath(() => {
      throw new Error('ENOENT');
    });

    expect(toDiskCase('/gone')).toBe('/gone');
  });

  it('is a no-op when the spelling already matches', () => {
    mockNativeRealpath(p => p);

    expect(toDiskCase('/ws/project')).toBe('/ws/project');
  });
});
