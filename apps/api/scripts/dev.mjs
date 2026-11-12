#!/usr/bin/env node
// Dev loop: `tsc --watch` (real decorator metadata via tsc) + `node --watch dist/main.js`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const children = [];

const tsc = spawn(
  process.execPath,
  [tscBin, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'],
  { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] },
);
children.push(tsc);

let server;
tsc.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (
    !server &&
    /Found 0 errors/.test(String(chunk)) &&
    existsSync(path.join(root, 'dist/main.js'))
  ) {
    server = spawn(
      process.execPath,
      ['--enable-source-maps', '--watch-path=dist', 'dist/main.js'],
      { cwd: root, stdio: 'inherit' },
    );
    children.push(server);
  }
});

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
