import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const islandRoot = path.resolve(root, '..');

await esbuild.build({
  entryPoints: [
    path.join(islandRoot, 'electron/main.ts'),
    path.join(islandRoot, 'electron/preload.ts'),
  ],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: path.join(islandRoot, 'dist-electron'),
  external: ['electron', 'exceljs'],
  sourcemap: true,
});

console.log('Electron main/preload собраны.');
