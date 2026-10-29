import * as fs from 'fs';
import * as path from 'path';
import type * as esbuild from 'esbuild';
import type { NFBuildAdapterResult } from '@softarc/native-federation/domain';

export function writeResult(
  result: esbuild.BuildResult<esbuild.BuildOptions>,
  outdir: string,
  entryByOutputName: Map<string, string>
): NFBuildAdapterResult[] {
  const outputFiles = result.outputFiles || [];
  if (outputFiles.length > 0) {
    fs.mkdirSync(outdir, { recursive: true });
  }
  // Flattening to the basename can write one path twice; core rejects two results for one entry.
  const written = new Map<string, NFBuildAdapterResult>();
  for (const outFile of outputFiles) {
    const fileName = path.basename(outFile.path);
    const filePath = path.join(outdir, fileName);
    fs.writeFileSync(filePath, outFile.contents);
    const entry = entryByOutputName.get(fileName);
    written.set(filePath, entry ? { fileName: filePath, entry } : { fileName: filePath });
  }

  return [...written.values()];
}
