#!/usr/bin/env node
/**
 * Local development services WITHOUT Docker.
 *
 * The primary local setup is `docker compose up -d` (see docker-compose.yml).
 * This launcher is a fallback for machines without Docker: it runs a REAL
 * PostgreSQL server from the `embedded-postgres` binaries (zonky builds) and,
 * optionally, a real Redis server through WSL / a native `redis-server` binary.
 *
 * Dev/test only. Never use for production. Data lives in `.local/` (gitignored).
 *
 * Usage:
 *   node tools/local-services/start.mjs            # postgres + redis (if available)
 *   node tools/local-services/start.mjs --no-redis
 *
 * Env (defaults match .env.example):
 *   LOCAL_PG_PORT=5432 LOCAL_PG_USER=rage LOCAL_PG_PASSWORD=rage_dev_password
 *   LOCAL_PG_DATABASES=rage,rage_test LOCAL_REDIS_PORT=6379
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = new Set(process.argv.slice(2));

const pgPort = Number(process.env.LOCAL_PG_PORT ?? 5432);
const pgUser = process.env.LOCAL_PG_USER ?? 'rage';
const pgPassword = process.env.LOCAL_PG_PASSWORD ?? 'rage_dev_password';
const databases = (process.env.LOCAL_PG_DATABASES ?? 'rage,rage_test')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const redisPort = Number(process.env.LOCAL_REDIS_PORT ?? 6379);
const dataDir = path.join(root, '.local', `postgres-${pgPort}`);

function log(msg) {
  process.stdout.write(`[local-services] ${msg}\n`);
}

function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function startPostgres() {
  if (await portInUse(pgPort)) {
    throw new Error(
      `Port ${pgPort} is already in use. Stop the other PostgreSQL (or Docker) instance or set LOCAL_PG_PORT.`,
    );
  }
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: pgUser,
    password: pgPassword,
    port: pgPort,
    persistent: true,
    authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: () => {},
    onError: (e) => process.stderr.write(`[postgres] ${String(e)}`),
  });

  const { existsSync } = await import('node:fs');
  if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
    log(`initialising cluster in ${path.relative(root, dataDir)}`);
    await pg.initialise();
  }
  await pg.start();
  log(`postgres listening on 127.0.0.1:${pgPort} (user ${pgUser})`);

  const client = pg.getPgClient();
  await client.connect();
  const { rows } = await client.query('SELECT datname FROM pg_database');
  const existing = new Set(rows.map((r) => r.datname));
  for (const db of databases) {
    if (!/^[a-z_][a-z0-9_]*$/.test(db)) throw new Error(`invalid database name: ${db}`);
    if (!existing.has(db)) {
      await client.query(`CREATE DATABASE "${db}"`);
      log(`created database ${db}`);
    }
  }
  const version = await client.query('SHOW server_version');
  log(`server_version ${version.rows[0].server_version}`);
  await client.end();
  return pg;
}

function findRedisCommand() {
  const native = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['redis-server'], {
    encoding: 'utf8',
  });
  if (native.status === 0) return { cmd: 'redis-server', prefix: [] };
  if (process.platform === 'win32') {
    const wsl = spawnSync('wsl', ['-e', 'sh', '-c', 'command -v redis-server'], {
      encoding: 'utf8',
    });
    if (wsl.status === 0 && wsl.stdout.trim())
      return { cmd: 'wsl', prefix: ['-e', 'redis-server'] };
  }
  return null;
}

async function startRedis() {
  if (await portInUse(redisPort)) {
    log(`port ${redisPort} already in use — assuming an existing Redis; not starting another`);
    return null;
  }
  const found = findRedisCommand();
  if (!found) {
    log(
      'redis-server not found (native or WSL). Redis-dependent readiness checks will report DOWN.',
    );
    return null;
  }
  const redisArgs = [
    ...found.prefix,
    '--port',
    String(redisPort),
    '--save',
    '',
    '--appendonly',
    'no',
    '--protected-mode',
    'yes',
    '--bind',
    '127.0.0.1',
  ];
  const child = spawn(found.cmd, redisArgs, { stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 50; i++) {
    if (await portInUse(redisPort)) {
      log(
        `redis listening on 127.0.0.1:${redisPort} (${found.cmd === 'wsl' ? 'via WSL' : 'native'})`,
      );
      return child;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  log('redis did not become reachable from this host; continuing without it');
  child.kill();
  return null;
}

const pg = await startPostgres();
const redis = args.has('--no-redis') ? null : await startRedis();
log('ready. Press Ctrl+C to stop.');

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  log('stopping…');
  if (redis) redis.kill();
  await pg.stop().catch((e) => process.stderr.write(String(e)));
  log('stopped');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Keep the process alive.
setInterval(() => {}, 1 << 30);
