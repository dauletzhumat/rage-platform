import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { RedisService } from '../infra/redis/redis.service.js';

export class LivenessDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
}

export class DependencyStatusDto {
  @ApiProperty({ enum: ['up', 'down'] })
  status!: 'up' | 'down';
}

export class ReadinessChecksDto {
  @ApiProperty({ type: DependencyStatusDto })
  database!: DependencyStatusDto;

  @ApiProperty({ type: DependencyStatusDto })
  redis!: DependencyStatusDto;
}

export class ReadinessDto {
  @ApiProperty({ enum: ['ok', 'error'] })
  status!: 'ok' | 'error';

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;
}

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  /**
   * Readiness is unthrottled (orchestrators poll it), so dependency probes are shared:
   * concurrent callers await one in-flight probe and results are reused for
   * READINESS_CACHE_MS. Bounds DB/Redis load from this endpoint (security LOW-3).
   */
  static readonly READINESS_CACHE_MS = 1000;
  private cached?: { at: number; result: Promise<{ db: boolean; redis: boolean }> };

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private probe(): Promise<{ db: boolean; redis: boolean }> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < HealthController.READINESS_CACHE_MS) {
      return this.cached.result;
    }
    const result = Promise.all([this.prisma.ping(), this.redis.ping()]).then(([db, redis]) => ({
      db,
      redis,
    }));
    this.cached = { at: now, result };
    return result;
  }

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness: the process is up (no dependency checks)' })
  @ApiOkResponse({ type: LivenessDto })
  live(): LivenessDto {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: PostgreSQL and Redis reachable' })
  @ApiOkResponse({ type: ReadinessDto })
  @ApiServiceUnavailableResponse({ type: ReadinessDto })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessDto> {
    const { db, redis } = await this.probe();
    const ok = db && redis;
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    res.setHeader('cache-control', 'no-store');
    return {
      status: ok ? 'ok' : 'error',
      checks: {
        database: { status: db ? 'up' : 'down' },
        redis: { status: redis ? 'up' : 'down' },
      },
    };
  }
}
