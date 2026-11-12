import { NotFoundException, ParseUUIDPipe, type PipeTransform } from '@nestjs/common';
import { RequestValidationException } from '../errors/validation.js';

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Public slug param: anything that cannot be a slug is simply "not found" (no DB hit). */
export class SlugParamPipe implements PipeTransform<string, string> {
  constructor(private readonly resource: string) {}
  transform(value: string): string {
    if (typeof value !== 'string' || !SLUG_PATTERN.test(value)) {
      throw new NotFoundException(`${this.resource} not found`);
    }
    return value;
  }
}

export const uuidParam = (field: string) =>
  new ParseUUIDPipe({
    exceptionFactory: () =>
      new RequestValidationException([{ field, message: `${field} must be a UUID` }]),
  });
