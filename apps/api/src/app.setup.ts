import { type INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { CSRF_HEADER, SESSION_COOKIE } from './auth/auth.constants.js';
import { CSRF_SECURITY, SESSION_SECURITY } from './auth/auth.decorators.js';
import { ApiErrorDto } from './common/errors/api-error.js';
import { flattenValidationErrors, RequestValidationException } from './common/errors/validation.js';
import { type RequestWithIds, resolveRequestIds } from './common/http/request-id.js';
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

  app.use((req: Request & RequestWithIds, res: Response, next: NextFunction) => {
    const ids = resolveRequestIds(req, res);
    req.id = ids.id;
    req.serverRequestId = ids.serverId;
    req.clientRequestId = ids.clientId;
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
    // Retry-After (409 IDEMPOTENCY_IN_PROGRESS, 429) and Idempotency-Replayed must be readable
    // by the cross-origin web client (TEAMS.md §7).
    exposedHeaders: ['x-request-id', 'retry-after', 'idempotency-replayed'],
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
        'Authentication: Steam OpenID 2.0 sign-in sets the httpOnly `rage_session` cookie; ' +
        'unsafe methods additionally require the `x-csrf-token` header (docs/AUTH.md). ' +
        'CS2 integration (M4+) is not implemented yet.',
    )
    .setVersion(APP_VERSION)
    .addCookieAuth(
      SESSION_COOKIE,
      { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
      SESSION_SECURITY,
    )
    .addApiKey({ type: 'apiKey', in: 'header', name: CSRF_HEADER }, CSRF_SECURITY)
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
