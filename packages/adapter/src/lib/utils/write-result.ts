import * as fs from 'fs';
import * as path from 'path';
import type * as esbuild from 'esbuild';

export function writeResult(
  result: esbuild.BuildResult<esbuild.BuildOptions>,
  outdir: string
): string[] {
  const outputFiles = result.outputFiles || [];
  if (outputFiles.length > 0) {
    fs.mkdirSync(outdir, { recursive: true });
  }
  const writtenFiles: string[] = [];
  for (const outFile of outputFiles) {
    const fileName = path.basename(outFile.path);
    const filePath = path.join(outdir, fileName);
    fs.writeFileSync(filePath, outFile.contents);
    writtenFiles.push(filePath);
  }

  return writtenFiles;
}
