import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import {
  AdminTeamApplicationPageDto,
  AdminTeamApplicationsQueryDto,
  ApproveTeamApplicationDto,
  CreateTeamApplicationDto,
  RejectTeamApplicationDto,
  TeamApplicationDto,
} from './team-applications.dto.js';
import { TeamApplicationsService } from './team-applications.service.js';

@ApiTags('team-applications')
@Controller('team-applications')
export class TeamApplicationsController {
  constructor(private readonly applications: TeamApplicationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Submit a team creation application (captain-to-be; audited)',
    description:
      'Requires a signed-in, non-sample user without an active membership or PENDING ' +
      'application. The slug is derived server-side from the name.',
  })
  @ApiCreatedResponse({ type: TeamApplicationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      'APPLICATION_ALREADY_PENDING | APPLICANT_IN_TEAM | TEAM_NAME_TAKEN | TEAM_TAG_TAKEN | ' +
      'SAMPLE_RESOURCE | IDEMPOTENCY_KEY_REUSED | IDEMPOTENCY_IN_PROGRESS',
  })
  submit(
    @CurrentUser() auth: AuthContext,
    @Body() dto: CreateTeamApplicationDto,
    @Req() req: RequestWithIds,
  ): Promise<TeamApplicationDto> {
    return this.applications.submit(auth.userId, dto, auditContextOf(req));
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Withdraw own PENDING application (audited)' })
  @ApiOkResponse({ type: TeamApplicationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Missing or not your application' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'APPLICATION_NOT_PENDING' })
  withdraw(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuidParam('id')) id: string,
    @Req() req: RequestWithIds,
  ): Promise<TeamApplicationDto> {
    return this.applications.withdraw(auth.userId, id, auditContextOf(req));
  }
}

@ApiTags('me')
@Controller('me/team-applications')
export class MyTeamApplicationsController {
  constructor(private readonly applications: TeamApplicationsService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: 'Own team applications, newest first (max 20)' })
  @ApiOkResponse({ type: [TeamApplicationDto] })
  list(@CurrentUser() auth: AuthContext): Promise<TeamApplicationDto[]> {
    return this.applications.listMine(auth.userId);
  }
}

@ApiTags('admin')
@Controller('admin/team-applications')
export class AdminTeamApplicationsController {
  constructor(private readonly applications: TeamApplicationsService) {}

  @Get()
  @RequireRoles(['SUPER_ADMIN'])
  @ApiOperation({ summary: 'Team application queue (default PENDING, oldest first)' })
  @ApiOkResponse({ type: AdminTeamApplicationPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  list(@Query() query: AdminTeamApplicationsQueryDto): Promise<AdminTeamApplicationPageDto> {
    return this.applications.listForAdmin(query);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(['SUPER_ADMIN'], { unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Approve: creates the team and the captain membership atomically (audited)',
  })
  @ApiOkResponse({ type: TeamApplicationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      'APPLICATION_NOT_PENDING | APPLICANT_INELIGIBLE | APPLICANT_IN_TEAM | TEAM_NAME_TAKEN | ' +
      'TEAM_TAG_TAKEN | IDEMPOTENCY_KEY_REUSED | IDEMPOTENCY_IN_PROGRESS',
  })
  approve(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: ApproveTeamApplicationDto,
    @Req() req: RequestWithIds,
  ): Promise<TeamApplicationDto> {
    return this.applications.approve(auth.userId, id, dto.note, auditContextOf(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(['SUPER_ADMIN'], { unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Reject with a reason visible to the applicant (audited)' })
  @ApiOkResponse({ type: TeamApplicationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'APPLICATION_NOT_PENDING' })
  reject(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: RejectTeamApplicationDto,
    @Req() req: RequestWithIds,
  ): Promise<TeamApplicationDto> {
    return this.applications.reject(auth.userId, id, dto.reason, auditContextOf(req));
  }
}
