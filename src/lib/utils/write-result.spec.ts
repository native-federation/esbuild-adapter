import type * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeResult } from './write-result.js';

const outputFile = (filePath: string, text: string) =>
  ({ path: filePath, contents: new TextEncoder().encode(text) }) as esbuild.OutputFile;

let outdir: string;

beforeEach(() => {
  outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-write-result-'));
});

afterEach(() => {
  fs.rmSync(outdir, { recursive: true, force: true });
});

describe('writeResult', () => {
  // Outputs are flattened to their basename, so nested outputs with one name land on one path;
  // core rejects two results for the same entry.
  it('returns one result per written path', () => {
    const result = {
      outputFiles: [outputFile('/out/a/same.js', 'first'), outputFile('/out/b/same.js', 'last')],
    } as esbuild.BuildResult;

    const written = writeResult(result, outdir, new Map());

    expect(written).toEqual([{ fileName: path.join(outdir, 'same.js') }]);
    expect(fs.readFileSync(path.join(outdir, 'same.js'), 'utf8')).toBe('last');
  });

  it('sets the entry from the map and leaves it out for unmatched outputs', () => {
    const result = {
      outputFiles: [
        outputFile('/out/chunk-AAAAAAAA.js', 'entry'),
        outputFile('/out/chunk-BBBBBBBB.js', 'split chunk'),
      ],
    } as esbuild.BuildResult;

    const written = writeResult(result, outdir, new Map([['chunk-AAAAAAAA.js', 'chunk.js']]));

    expect(written).toEqual([
      { fileName: path.join(outdir, 'chunk-AAAAAAAA.js'), entry: 'chunk.js' },
      { fileName: path.join(outdir, 'chunk-BBBBBBBB.js') },
    ]);
  });
});
