import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { auditContextOf } from '../audit/audit.service.js';
import { Authenticated } from '../auth/auth.decorators.js';
import { CurrentUser } from '../auth/guards.js';
import type { AuthContext } from '../auth/session.service.js';
import { ApiErrorDto } from '../common/errors/api-error.js';
import { uuidParam } from '../common/http/params.js';
import type { RequestWithIds } from '../common/http/request-id.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { CreateRegistrationDto, RegistrationDto } from './registrations.dto.js';
import { RegistrationsService } from './registrations.service.js';

const REGISTER_CONFLICTS =
  'REGISTRATION_CLOSED | ALREADY_REGISTERED | PLAYER_INELIGIBLE (details: [{ field: userId, ' +
  'message: NOT_TEAM_MEMBER | USER_INACTIVE | SAMPLE | BANNED | ALREADY_REGISTERED_ELSEWHERE }]) ' +
  '| TEAM_NOT_ACTIVE | SAMPLE_RESOURCE | IDEMPOTENCY_KEY_REUSED | IDEMPOTENCY_IN_PROGRESS';

@ApiTags('tournaments')
@Controller('tournaments/:id/registrations')
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Register a team with a roster snapshot (team operator; audited)',
    description:
      'Creates a PENDING registration and roster version 1 (DRAFT) snapshotting SteamID64 and ' +
      'nickname of 5 starters and up to 2 substitutes (docs/TOURNAMENTS.md §4).',
  })
  @ApiCreatedResponse({ type: RegistrationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'VALIDATION_FAILED | ROSTER_INVALID' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'FORBIDDEN_ROLE | CSRF_FAILED' })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: REGISTER_CONFLICTS })
  register(
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: CreateRegistrationDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<RegistrationDto> {
    return this.registrations.register(auth.userId, id, dto, auditContextOf(req));
  }

  @Put(':registrationId/roster')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Replace the roster of a PENDING registration (new DRAFT version; audited)',
  })
  @ApiOkResponse({ type: RegistrationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'VALIDATION_FAILED | ROSTER_INVALID' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'FORBIDDEN_ROLE | CSRF_FAILED' })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: `REGISTRATION_NOT_PENDING | ${REGISTER_CONFLICTS}`,
  })
  updateRoster(
    @Param('id', uuidParam('id')) id: string,
    @Param('registrationId', uuidParam('registrationId')) registrationId: string,
    @Body() dto: CreateRegistrationDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<RegistrationDto> {
    return this.registrations.updateRoster(
      auth.userId,
      id,
      registrationId,
      dto,
      auditContextOf(req),
    );
  }

  @Post(':registrationId/withdraw')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Withdraw a PENDING/APPROVED registration before the tournament starts (audited)',
  })
  @ApiOkResponse({ type: RegistrationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'FORBIDDEN_ROLE | CSRF_FAILED' })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'REGISTRATION_NOT_PENDING | INVALID_STATE_TRANSITION | SAMPLE_RESOURCE',
  })
  withdraw(
    @Param('id', uuidParam('id')) id: string,
    @Param('registrationId', uuidParam('registrationId')) registrationId: string,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<RegistrationDto> {
    return this.registrations.withdraw(auth.userId, id, registrationId, auditContextOf(req));
  }
}

@ApiTags('me')
@Controller('me/registrations')
export class MyRegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get()
  @Authenticated()
  @ApiOperation({
    summary: 'Tournament registrations of teams you operate (captain / TEAM_MANAGER), max 50',
  })
  @ApiOkResponse({ type: [RegistrationDto] })
  list(@CurrentUser() auth: AuthContext): Promise<RegistrationDto[]> {
    return this.registrations.listMine(auth.userId);
  }
}
