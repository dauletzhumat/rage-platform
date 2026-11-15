import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
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
import { Authenticated, RequireRoles } from '../auth/auth.decorators.js';
import { CurrentUser } from '../auth/guards.js';
import type { AuthContext } from '../auth/session.service.js';
import { ApiErrorDto } from '../common/errors/api-error.js';
import { uuidParam } from '../common/http/params.js';
import type { RequestWithIds } from '../common/http/request-id.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { BracketDto } from '../tournaments/tournaments.dto.js';
import { BracketAdminService } from './bracket-admin.service.js';
import { RegistrationReviewService } from './registration-review.service.js';
import {
  AdminRegistrationDto,
  AdminRegistrationPageDto,
  AdminRegistrationsQueryDto,
  AdminTournamentDto,
  AdminTournamentPageDto,
  AdminTournamentsQueryDto,
  ApproveRegistrationDto,
  CreateTournamentDto,
  RejectRegistrationDto,
  SeedsDto,
  SubstituteRegistrationDto,
  TournamentStatusChangeDto,
  UpdateTournamentDto,
} from './tournament-admin.dto.js';
import { TournamentAdminService } from './tournament-admin.service.js';

const FORBIDDEN = 'FORBIDDEN_ROLE (not a tournament admin of this tournament) | CSRF_FAILED';

@ApiTags('admin')
@Controller('admin/tournaments')
export class AdminTournamentsController {
  constructor(
    private readonly tournaments: TournamentAdminService,
    private readonly review: RegistrationReviewService,
    private readonly brackets: BracketAdminService,
  ) {}

  @Get()
  @Authenticated()
  @ApiOperation({
    summary:
      'All tournaments incl. DRAFT (SUPER_ADMIN / global TOURNAMENT_ADMIN; scoped admins see theirs)',
  })
  @ApiOkResponse({ type: AdminTournamentPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'FORBIDDEN_ROLE' })
  list(
    @CurrentUser() auth: AuthContext,
    @Query() query: AdminTournamentsQueryDto,
  ): Promise<AdminTournamentPageDto> {
    return this.tournaments.list(auth.userId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(['SUPER_ADMIN', 'TOURNAMENT_ADMIN'], { unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Create a DRAFT tournament (SUPER_ADMIN or global TOURNAMENT_ADMIN)' })
  @ApiCreatedResponse({ type: AdminTournamentDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'TOURNAMENT_NAME_TAKEN | FORMAT_NOT_SUPPORTED',
  })
  create(
    @Body() dto: CreateTournamentDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<AdminTournamentDto> {
    return this.tournaments.create(auth.userId, dto, auditContextOf(req));
  }

  @Get(':id')
  @Authenticated()
  @ApiOperation({ summary: 'One tournament incl. DRAFT (tournament admin)' })
  @ApiOkResponse({ type: AdminTournamentDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'FORBIDDEN_ROLE' })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @Param('id', uuidParam('id')) id: string,
    @CurrentUser() auth: AuthContext,
  ): Promise<AdminTournamentDto> {
    return this.tournaments.get(auth.userId, id);
  }

  @Patch(':id')
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Edit settings while DRAFT or REGISTRATION_OPEN (tournament admin)' })
  @ApiOkResponse({ type: AdminTournamentDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: FORBIDDEN })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      'INVALID_STATE_TRANSITION | TOURNAMENT_NAME_TAKEN | FORMAT_NOT_SUPPORTED | TOURNAMENT_FULL | SAMPLE_RESOURCE',
  })
  update(
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: UpdateTournamentDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<AdminTournamentDto> {
    return this.tournaments.update(auth.userId, id, dto, auditContextOf(req));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Lifecycle transition { to, reason? } (reason required for CANCELLED; audited)',
  })
  @ApiOkResponse({ type: AdminTournamentDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: FORBIDDEN })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'INVALID_STATE_TRANSITION | SAMPLE_RESOURCE',
  })
  changeStatus(
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: TournamentStatusChangeDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<AdminTournamentDto> {
    return this.tournaments.changeStatus(auth.userId, id, dto, auditContextOf(req));
  }

  @Get(':id/registrations')
  @Authenticated()
  @ApiOperation({ summary: 'Registrations of a tournament, oldest first (tournament admin)' })
  @ApiOkResponse({ type: AdminRegistrationPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'FORBIDDEN_ROLE' })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  registrations(
    @Param('id', uuidParam('id')) id: string,
    @Query() query: AdminRegistrationsQueryDto,
    @CurrentUser() auth: AuthContext,
  ): Promise<AdminRegistrationPageDto> {
    return this.review.list(auth.userId, id, query);
  }

  @Post(':id/registrations/:registrationId/approve')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Approve: re-validates the snapshot, locks the roster (tournament admin; audited)',
  })
  @ApiOkResponse({ type: AdminRegistrationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: FORBIDDEN })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      'REGISTRATION_NOT_PENDING | TOURNAMENT_FULL | PLAYER_INELIGIBLE | INVALID_STATE_TRANSITION | TEAM_NOT_ACTIVE | SAMPLE_RESOURCE',
  })
  approve(
    @Param('id', uuidParam('id')) id: string,
    @Param('registrationId', uuidParam('registrationId')) registrationId: string,
    @Body() dto: ApproveRegistrationDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<AdminRegistrationDto> {
    return this.review.approve(auth.userId, id, registrationId, dto.note, auditContextOf(req));
  }

  @Post(':id/registrations/:registrationId/reject')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Reject with a reason visible to the team (tournament admin; audited)' })
  @ApiOkResponse({ type: AdminRegistrationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: FORBIDDEN })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'REGISTRATION_NOT_PENDING | SAMPLE_RESOURCE',
  })
  reject(
    @Param('id', uuidParam('id')) id: string,
    @Param('registrationId', uuidParam('registrationId')) registrationId: string,
    @Body() dto: RejectRegistrationDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<AdminRegistrationDto> {
    return this.review.reject(auth.userId, id, registrationId, dto.reason, auditContextOf(req));
  }

  @Post(':id/registrations/:registrationId/substitute')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Substitute a player in a LOCKED roster (new version; tournament admin; audited)',
  })
  @ApiOkResponse({ type: AdminRegistrationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'VALIDATION_FAILED | ROSTER_INVALID' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: FORBIDDEN })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'SUBSTITUTION_NOT_ALLOWED | PLAYER_INELIGIBLE | SAMPLE_RESOURCE',
  })
  substitute(
    @Param('id', uuidParam('id')) id: string,
    @Param('registrationId', uuidParam('registrationId')) registrationId: string,
    @Body() dto: SubstituteRegistrationDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<AdminRegistrationDto> {
    return this.review.substitute(auth.userId, id, registrationId, dto, auditContextOf(req));
  }

  @Put(':id/seeds')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Set seeds 1..N for every APPROVED registration (REGISTRATION_CLOSED; audited)',
  })
  @ApiOkResponse({ type: [AdminRegistrationDto] })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'VALIDATION_FAILED | SEEDS_INVALID' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: FORBIDDEN })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'INVALID_STATE_TRANSITION | SAMPLE_RESOURCE',
  })
  seeds(
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: SeedsDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<AdminRegistrationDto[]> {
    return this.brackets.setSeeds(auth.userId, id, dto, auditContextOf(req));
  }

  @Post(':id/generate-bracket')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Generate the single-elimination bracket; tournament → IN_PROGRESS (audited)',
  })
  @ApiOkResponse({ type: BracketDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: FORBIDDEN })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'BRACKET_EXISTS | NOT_ENOUGH_TEAMS | INVALID_STATE_TRANSITION | SAMPLE_RESOURCE',
  })
  generate(
    @Param('id', uuidParam('id')) id: string,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<BracketDto> {
    return this.brackets.generate(auth.userId, id, auditContextOf(req));
  }
}
