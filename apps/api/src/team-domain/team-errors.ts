import {
  ConflictException,
  ForbiddenException,
  type HttpException,
  NotFoundException,
} from '@nestjs/common';
import { DB_CONSTRAINTS, getDbViolation } from '@rage/db';
import { API_ERROR_CODES, type ApiErrorCode, errorBody } from '../common/errors/api-error.js';
import { RequestValidationException } from '../common/errors/validation.js';

export const conflict = (code: ApiErrorCode, message: string) =>
  new ConflictException(errorBody(message, code));

export const notFoundWithCode = (code: ApiErrorCode, message: string) =>
  new NotFoundException(errorBody(message, code));

export const forbiddenRole = () =>
  new ForbiddenException(errorBody('Insufficient permissions', API_ERROR_CODES.forbiddenRole));

export const fieldError = (field: string, message: string) =>
  new RequestValidationException([{ field, message }]);

export const sampleResource = () =>
  conflict(API_ERROR_CODES.sampleResource, 'Sample (demo) resources cannot be changed');

export const teamNameTaken = () =>
  conflict(API_ERROR_CODES.teamNameTaken, 'A team or pending application already uses this name');
export const teamTagTaken = () =>
  conflict(API_ERROR_CODES.teamTagTaken, 'A team or pending application already uses this tag');
export const alreadyInTeam = () =>
  conflict(API_ERROR_CODES.alreadyInTeam, 'You are already an active member of a team');
export const notTeamMember = () =>
  notFoundWithCode(API_ERROR_CODES.notTeamMember, 'User is not an active member of this team');
export const captainMustTransfer = () =>
  conflict(API_ERROR_CODES.captainMustTransfer, 'The captain must transfer captaincy first');
export const invitationNotPending = () =>
  conflict(API_ERROR_CODES.invitationNotPending, 'Invitation is no longer pending');
export const invitationExpired = () =>
  conflict(API_ERROR_CODES.invitationExpired, 'Invitation has expired');

/**
 * Translates known constraint violations (by constraint name from `DB_CONSTRAINTS`, never by
 * message text) into contract errors. Anything unmapped is rethrown unchanged, so unexpected
 * database errors still surface as the generic 500 / 409 of the global filter.
 */
export function rethrowMapped(
  err: unknown,
  map: Partial<Record<string, () => HttpException>>,
): never {
  const violation = getDbViolation(err);
  const factory = violation?.constraint ? map[violation.constraint] : undefined;
  if (factory) throw factory();
  throw err;
}

/** Name / tag uniqueness constraints shared by application submit, approval and admin create. */
export const TEAM_IDENTITY_CONSTRAINTS: Partial<Record<string, () => HttpException>> = {
  [DB_CONSTRAINTS.teamNameUnique]: teamNameTaken,
  [DB_CONSTRAINTS.teamNameCaseInsensitiveUnique]: teamNameTaken,
  [DB_CONSTRAINTS.teamTagCaseInsensitiveUnique]: teamTagTaken,
  [DB_CONSTRAINTS.applicationPendingNameUnique]: teamNameTaken,
  [DB_CONSTRAINTS.applicationPendingTagUnique]: teamTagTaken,
};
