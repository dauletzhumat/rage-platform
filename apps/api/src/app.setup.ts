import { type INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ApiErrorDto } from './common/errors/api-error.js';
import { flattenValidationErrors, RequestValidationException } from './common/errors/validation.js';
import { resolveRequestId } from './common/http/request-id.js';
import { type Env } from './config/env.js';
import { APP_VERSION } from './version.js';

export const GLOBAL_PREFIX = 'api/v1';
export const DOCS_PATH = 'api/docs';

/**
 * Applies all cross-cutting HTTP concerns. Shared by `main.ts` and the integration
 * tests so tests exercise the exact production middleware stack.
 */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.useLogger(app.get(Logger));
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');

  app.use((req: Request & { id?: string }, res: Response, next: NextFunction) => {
    req.id = resolveRequestId(req, res);
    next();
  });

  // Swagger UI needs to load its own assets; everything else is JSON-only and locked down.
  const docsPrefix = `/${DOCS_PATH}`;
  const apiHelmet = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  const docsHelmet = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
      },
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) =>
    (req.path.startsWith(docsPrefix) ? docsHelmet : apiHelmet)(req, res, next),
  );

  app.enableCors({
    origin: env.API_CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-request-id', 'x-csrf-token', 'idempotency-key'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });

  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
      exceptionFactory: (errors) => new RequestValidationException(flattenValidationErrors(errors)),
    }),
  );
  app.enableShutdownHooks();
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('RAGE Platform API')
    .setDescription(
      'RAGE Platform REST API v1. Conventions: docs/API_CONVENTIONS.md. ' +
        'Steam authentication (M1) and CS2 integration (M4+) are not implemented yet.',
    )
    .setVersion(APP_VERSION)
    .addServer('/', 'This server')
    .build();
  return SwaggerModule.createDocument(app, config, {
    extraModels: [ApiErrorDto],
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup(DOCS_PATH, app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: `${DOCS_PATH}-json`,
    yamlDocumentUrl: `${DOCS_PATH}-yaml`,
  });
}
