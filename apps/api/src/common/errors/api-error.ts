import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const API_ERROR_CODES = {
  unauthenticated: 'UNAUTHENTICATED',
  csrfFailed: 'CSRF_FAILED',
  forbiddenRole: 'FORBIDDEN_ROLE',
  roleAlreadyGranted: 'ROLE_ALREADY_GRANTED',
  lastSuperAdmin: 'LAST_SUPER_ADMIN',
  validationFailed: 'VALIDATION_FAILED',
  rateLimited: 'RATE_LIMITED',
  // M2 (docs/TEAMS.md §8)
  sampleResource: 'SAMPLE_RESOURCE',
  applicationAlreadyPending: 'APPLICATION_ALREADY_PENDING',
  applicationNotPending: 'APPLICATION_NOT_PENDING',
  applicantInTeam: 'APPLICANT_IN_TEAM',
  applicantIneligible: 'APPLICANT_INELIGIBLE',
  teamNameTaken: 'TEAM_NAME_TAKEN',
  teamTagTaken: 'TEAM_TAG_TAKEN',
  teamNotActive: 'TEAM_NOT_ACTIVE',
  playerNotFound: 'PLAYER_NOT_FOUND',
  alreadyMember: 'ALREADY_MEMBER',
  invitationAlreadyPending: 'INVITATION_ALREADY_PENDING',
  invitationLimit: 'INVITATION_LIMIT',
  invitationNotPending: 'INVITATION_NOT_PENDING',
  invitationExpired: 'INVITATION_EXPIRED',
  alreadyInTeam: 'ALREADY_IN_TEAM',
  rosterFull: 'ROSTER_FULL',
  notTeamMember: 'NOT_TEAM_MEMBER',
  captainMustTransfer: 'CAPTAIN_MUST_TRANSFER',
  idempotencyKeyReused: 'IDEMPOTENCY_KEY_REUSED',
  idempotencyInProgress: 'IDEMPOTENCY_IN_PROGRESS',
  // M2 security gate follow-ups
  memberIneligible: 'MEMBER_INELIGIBLE',
  applicationLimit: 'APPLICATION_LIMIT',
  invitationCooldown: 'INVITATION_COOLDOWN',
} as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export class ApiErrorDetailDto {
  @ApiProperty({ description: 'Field path (dot notation) or "(root)"', example: 'pageSize' })
  field!: string;

  @ApiProperty({ example: 'pageSize must not be greater than 100' })
  message!: string;
}

/** Normalized error envelope returned by every failing endpoint. */
export class ApiErrorDto {
  @ApiProperty({ example: 404 })
  statusCode!: number;

  @ApiProperty({ example: 'Not Found', description: 'HTTP reason phrase' })
  error!: string;

  @ApiProperty({ example: 'Team not found' })
  message!: string;

  @ApiProperty({ example: '0b6b6c4e-7c0e-4d1b-9a43-0d8b0b0e8a11' })
  requestId!: string;

  @ApiPropertyOptional({ type: [ApiErrorDetailDto] })
  details?: ApiErrorDetailDto[];

  @ApiPropertyOptional({
    description:
      'Stable machine-readable code (branch on this, never on `message`). Known values: ' +
      Object.values(API_ERROR_CODES).join(', ') +
      '. New codes may be added.',
    example: 'CSRF_FAILED',
  })
  code?: string;
}

/** Body helper for HttpExceptions that carry a machine-readable code. */
export function errorBody(message: string, code: ApiErrorCode): { message: string; code: string } {
  return { message, code };
}
