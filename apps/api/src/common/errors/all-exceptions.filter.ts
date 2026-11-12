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
import type { ApiErrorDto } from './api-error.js';
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

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (exception instanceof RequestValidationException) {
        message = exception.message;
        details = exception.details;
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
      }
      if (status >= 500) {
        // Never echo internal exception text for server errors.
        message = STATUS_CODES[status] ?? 'Internal server error';
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
    };
    if (!res.headersSent) {
      res.status(status).json(payload);
    }
  }
}
