import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { IncomingMessage } from 'node:http';
import { LoggerModule, type Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { serializeRequest, serializeResponse } from './common/http/log-serializers.js';
import { AppConfigModule } from './config/config.module.js';
import { type Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { InfraModule } from './infra/infra.module.js';
import { MatchesModule } from './matches/matches.module.js';
import { MetaModule } from './meta/meta.module.js';
import { PlayersModule } from './players/players.module.js';
import { TeamsModule } from './teams/teams.module.js';
import { TournamentsModule } from './tournaments/tournaments.module.js';

type RequestWithId = Omit<IncomingMessage, 'id'> & { id?: string };

export interface AppModuleOptions {
  /** Test hook: capture structured logs instead of writing to stdout. */
  logStream?: DestinationStream;
}

@Module({})
export class AppModule {
  static forRoot(env: Env, options: AppModuleOptions = {}): DynamicModule {
    const pretty = env.NODE_ENV === 'development' && process.stdout.isTTY && !options.logStream;
    const pinoOptions: PinoHttpOptions = {
      level: env.LOG_LEVEL,
      // The request id is assigned earlier by the request-id middleware (configureApp).
      genReqId: (req: IncomingMessage) => (req as RequestWithId).id ?? 'unknown',
      autoLogging: {
        ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/api/v1/health'),
      },
      // Allowlist serializers: no query strings, no sensitive headers (security MEDIUM-1).
      serializers: { req: serializeRequest, res: serializeResponse },
      ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
    };
    const loggerParams: Params = {
      pinoHttp: options.logStream ? [pinoOptions, options.logStream] : pinoOptions,
    };

    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(env),
        LoggerModule.forRoot(loggerParams),
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE },
        ]),
        InfraModule,
        HealthModule,
        MetaModule,
        PlayersModule,
        TeamsModule,
        TournamentsModule,
        MatchesModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
