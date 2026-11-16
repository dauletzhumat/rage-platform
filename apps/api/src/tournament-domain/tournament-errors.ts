import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DB_CONSTRAINTS } from '@rage/db';
import {
  API_ERROR_CODES,
  type ApiErrorDetailDto,
  errorBody,
  errorBodyWithDetails,
} from '../common/errors/api-error.js';
import { conflict } from '../team-domain/team-errors.js';

/** Error factories for the M3 contract codes (docs/TOURNAMENTS.md §11). */

export const tournamentNotFound = () => new NotFoundException('Tournament not found');
export const registrationNotFound = () => new NotFoundException('Registration not found');
export const matchNotFound = () => new NotFoundException('Match not found');

export const invalidStateTransition = (message: string) =>
  conflict(API_ERROR_CODES.invalidStateTransition, message);
export const formatNotSupported = () =>
  conflict(
    API_ERROR_CODES.formatNotSupported,
    'Only SINGLE_ELIMINATION tournaments are supported in this release',
  );
export const tournamentNameTaken = () =>
  conflict(API_ERROR_CODES.tournamentNameTaken, 'A tournament with this name already exists');
export const registrationClosed = () =>
  conflict(API_ERROR_CODES.registrationClosed, 'Registration is not open for this tournament');
export const alreadyRegistered = () =>
  conflict(API_ERROR_CODES.alreadyRegistered, 'This team already registered for the tournament');
export const tournamentFull = () =>
  conflict(API_ERROR_CODES.tournamentFull, 'The tournament has reached its maximum team count');
export const registrationNotPending = () =>
  conflict(API_ERROR_CODES.registrationNotPending, 'Registration is not pending');
export const notEnoughTeams = () =>
  conflict(API_ERROR_CODES.notEnoughTeams, 'At least 2 approved teams are required');
export const bracketExists = () =>
  conflict(API_ERROR_CODES.bracketExists, 'The bracket has already been generated');
export const matchNotReady = (message = 'Match is not ready for this action') =>
  conflict(API_ERROR_CODES.matchNotReady, message);
export const matchAlreadyCompleted = () =>
  conflict(API_ERROR_CODES.matchAlreadyCompleted, 'Match is already completed');
export const vetoNotYourTurn = () =>
  conflict(API_ERROR_CODES.vetoNotYourTurn, 'It is not your turn (or not this action) in the veto');
export const vetoInvalidMap = () =>
  conflict(API_ERROR_CODES.vetoInvalidMap, 'Map is not in the remaining pool');
export const vetoComplete = () =>
  conflict(API_ERROR_CODES.vetoComplete, 'The map veto is already complete');
export const substitutionNotAllowed = (message: string) =>
  conflict(API_ERROR_CODES.substitutionNotAllowed, message);
export const steamIdAlreadyBanned = () =>
  conflict(API_ERROR_CODES.steamIdAlreadyBanned, 'This SteamID64 already has an active ban');

export const rosterInvalid = (details: ApiErrorDetailDto[]) =>
  new BadRequestException(
    errorBodyWithDetails('Roster is invalid', API_ERROR_CODES.rosterInvalid, details),
  );
export const seedsInvalid = (message: string) =>
  new BadRequestException(errorBody(message, API_ERROR_CODES.seedsInvalid));
export const scoreInvalid = (message: string) =>
  new BadRequestException(errorBody(message, API_ERROR_CODES.scoreInvalid));
export const playerIneligible = (details: ApiErrorDetailDto[]) =>
  new ConflictException(
    errorBodyWithDetails(
      'One or more players are not eligible',
      API_ERROR_CODES.playerIneligible,
      details,
    ),
  );

/** Tournament name / slug uniqueness → contract codes (by constraint name only). */
export const TOURNAMENT_IDENTITY_CONSTRAINTS = {
  [DB_CONSTRAINTS.tournamentNameCaseInsensitiveUnique]: tournamentNameTaken,
};
