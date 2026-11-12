import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { ApiErrorDetailDto } from './api-error.js';

export class RequestValidationException extends BadRequestException {
  constructor(readonly details: ApiErrorDetailDto[]) {
    super('Request validation failed');
  }
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): ApiErrorDetailDto[] {
  const out: ApiErrorDetailDto[] = [];
  for (const err of errors) {
    const field = parent ? `${parent}.${err.property}` : err.property;
    for (const message of Object.values(err.constraints ?? {})) {
      out.push({ field, message });
    }
    if (err.children?.length) out.push(...flattenValidationErrors(err.children, field));
  }
  return out;
}
