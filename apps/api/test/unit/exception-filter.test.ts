import {
  type ArgumentsHost,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from '../../src/common/errors/all-exceptions.filter.js';
import { RequestValidationException } from '../../src/common/errors/validation.js';

function run(exception: unknown) {
  const out: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    headersSent: false,
    getHeader: () => undefined,
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      out.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: 'req-1' }) }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return out;
}

function prismaError(code: string) {
  const e = new Error(`Unique constraint failed on the fields: (\`steam_id64\`) SELECT secret`);
  e.name = 'PrismaClientKnownRequestError';
  Object.assign(e, { code });
  return e;
}

describe('AllExceptionsFilter', () => {
  it('normalizes HttpExceptions', () => {
    const { status, body } = run(new NotFoundException('Team not found'));
    expect(status).toBe(404);
    expect(body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Team not found',
      requestId: 'req-1',
    });
  });

  it('includes validation details', () => {
    const { status, body } = run(
      new RequestValidationException([{ field: 'pageSize', message: 'too big' }]),
    );
    expect(status).toBe(400);
    expect(body?.details).toEqual([{ field: 'pageSize', message: 'too big' }]);
  });

  it('hides internals of unknown errors', () => {
    const { status, body } = run(new Error('connect ECONNREFUSED postgres://user:pw@db'));
    expect(status).toBe(500);
    expect(body?.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('pw@db');
  });

  it('maps Prisma unique violations to 409 without leaking SQL/columns', () => {
    const { status, body } = run(prismaError('P2002'));
    expect(status).toBe(409);
    expect(JSON.stringify(body)).not.toMatch(/steam_id64|SELECT/);
  });

  it('maps Prisma record-not-found to 404', () => {
    expect(run(prismaError('P2025')).status).toBe(404);
  });

  it('treats other Prisma errors as opaque 500s', () => {
    expect(run(prismaError('P2034')).status).toBe(500);
  });

  it('keeps 403 distinct', () => {
    expect(run(new ForbiddenException()).status).toBe(403);
  });

  it('normalizes 429 text (no framework class names)', () => {
    const { status, body } = run(
      new HttpException('ThrottlerException: Too Many Requests', HttpStatus.TOO_MANY_REQUESTS),
    );
    expect(status).toBe(429);
    expect(body?.message).toBe('Too many requests, please retry later');
  });

  it('never echoes internal text of 5xx HttpExceptions', () => {
    const { status, body } = run(
      new HttpException('pool exhausted at db-primary:5432', HttpStatus.SERVICE_UNAVAILABLE),
    );
    expect(status).toBe(503);
    expect(body?.message).toBe('Service Unavailable');
  });
});
