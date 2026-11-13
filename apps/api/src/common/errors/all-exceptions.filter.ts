import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';
import { API_ERROR_CODES, type ApiErrorDto } from './api-error.js';
import { RequestValidationException } from './validation.js';

type RequestWithId = Request & { id?: string | number };

/**
 * Duck-typed so this filter does not depend on Prisma's runtime classes.
 * Only the error *code* is used — constraint names/SQL are never sent to clients.
 */
export function prismaKnownCode(err: unknown): string | undefined {
  if (!(err instanceof Error) || err.name !== 'PrismaClientKnownRequestError') return undefined;
  const code: unknown = (err as Error & { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Named throttlers emit `Retry-After-<name>` only; clients (and the web app) read the
 * standard `Retry-After`. Copy the largest named value when the standard one is missing
 * (QA gate M1 P3-1).
 */
export function setStandardRetryAfter(res: Partial<Response>): void {
  if (typeof res.getHeaderNames !== 'function' || typeof res.setHeader !== 'function') return;
  if (res.getHeader?.('retry-after') !== undefined) return;
  let seconds: number | undefined;
  for (const name of res.getHeaderNames()) {
    if (!name.toLowerCase().startsWith('retry-after-')) continue;
    const value = Number(res.getHeader?.(name));
    if (Number.isFinite(value) && value >= 0) seconds = Math.max(seconds ?? 0, Math.ceil(value));
  }
  if (seconds !== undefined) res.setHeader('Retry-After', String(seconds));
}

/**
 * Converts every thrown error into the normalized `ApiErrorDto` envelope.
 * Unknown errors become a generic 500 — internals (stack, SQL, Prisma codes) never leak.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<RequestWithId>();
    const requestId = String(req.id ?? res.getHeader('x-request-id') ?? 'unknown');

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: ApiErrorDto['details'];
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (body && typeof body === 'object' && 'code' in body) {
        const c = (body as { code: unknown }).code;
        if (typeof c === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(c)) code = c;
      }
      if (exception instanceof RequestValidationException) {
        message = exception.message;
        details = exception.details;
        code = API_ERROR_CODES.validationFailed;
      } else if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object' && 'message' in body) {
        const m = (body as { message: unknown }).message;
        message = Array.isArray(m) ? m.map(String).join('; ') : String(m);
      } else {
        message = exception.message;
      }
      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        // Throttler's default text includes its class name; keep the envelope clean.
        message = 'Too many requests, please retry later';
        code = API_ERROR_CODES.rateLimited;
        setStandardRetryAfter(res);
      }
      if (status === HttpStatus.UNAUTHORIZED) code ??= API_ERROR_CODES.unauthenticated;
      if (status >= 500) {
        // Never echo internal exception text for server errors.
        message = STATUS_CODES[status] ?? 'Internal server error';
        code = undefined;
        this.logger.error({ err: exception, requestId }, 'HTTP 5xx exception');
      }
    } else if (prismaKnownCode(exception) === 'P2002') {
      // Unique constraint violation (incl. races that pass service-level checks).
      status = HttpStatus.CONFLICT;
      message = 'Resource conflicts with an existing record';
    } else if (prismaKnownCode(exception) === 'P2025') {
      status = HttpStatus.NOT_FOUND;
      message = 'Resource not found';
    } else {
      this.logger.error({ err: exception, requestId }, 'Unhandled exception');
    }

    const payload: ApiErrorDto = {
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      message,
      requestId,
      ...(details ? { details } : {}),
      ...(code ? { code } : {}),
    };
    if (!res.headersSent) {
      res.status(status).json(payload);
    }
  }
}
