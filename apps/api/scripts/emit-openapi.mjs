#!/usr/bin/env node
// Emits the OpenAPI document from the compiled API (dist/) WITHOUT connecting to
// PostgreSQL/Redis (both clients connect lazily). Output is key-sorted for stable diffs.
// Consumed by packages/api-client (openapi-typescript). CI fails on drift.
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../../packages/api-client/openapi.json');

const { AppModule } = await import('../dist/app.module.js');
const { configureApp, buildOpenApiDocument } = await import('../dist/app.setup.js');
const { parseEnv } = await import('../dist/config/env.js');

// Placeholder values: nothing is contacted while building the document.
const env = parseEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://openapi:unused@127.0.0.1:1/unused',
  REDIS_URL: 'redis://127.0.0.1:1',
  APP_VERSION: '0.0.0',
});

const app = await NestFactory.create(AppModule.forRoot(env), {
  logger: false,
  abortOnError: false,
});
configureApp(app, env);
const doc = buildOpenApiDocument(app);
await app.close();

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(sortKeys(doc), null, 2)}\n`);
console.log(
  `OpenAPI written to ${path.relative(process.cwd(), out)} (${Object.keys(doc.paths).length} paths)`,
);
