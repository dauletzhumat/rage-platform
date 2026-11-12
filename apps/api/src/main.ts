import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp, setupSwagger } from './app.setup.js';
import { EnvValidationError, loadDotEnvForDevelopment, parseEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  loadDotEnvForDevelopment();
  let env;
  try {
    env = parseEnv(process.env);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
  });
  configureApp(app, env);
  if (env.API_DOCS_ENABLED) setupSwagger(app);

  await app.listen(env.API_PORT, env.API_HOST);
}

void bootstrap();
