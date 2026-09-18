import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const islandRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Собирает main и preload Electron */
async function buildElectron() {
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
}

await buildElectron();

const viteBin = path.join(islandRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const waitOnBin = path.join(islandRoot, 'node_modules', 'wait-on', 'bin', 'wait-on');
const electronCli = path.join(islandRoot, 'node_modules', 'electron', 'cli.js');

const vite = spawn(process.execPath, [viteBin], {
  cwd: islandRoot,
  stdio: 'inherit',
  env: process.env,
});

const wait = spawn(
  process.execPath,
  [waitOnBin, 'http://127.0.0.1:5173'],
  { cwd: islandRoot, stdio: 'inherit', env: process.env },
);

wait.on('exit', (code) => {
  if (code !== 0) {
    vite.kill();
    process.exit(code ?? 1);
  }

  const electron = spawn(process.execPath, [electronCli, '.'], {
    cwd: islandRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    },
  });

  const shutdown = () => {
    electron.kill();
    vite.kill();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  electron.on('exit', (exitCode) => {
    vite.kill();
    process.exit(exitCode ?? 0);
  });
});
