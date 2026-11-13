import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { SlugParamPipe, uuidParam } from '../common/http/params.js';
import type { RequestWithIds } from '../common/http/request-id.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { TeamDetailDto } from '../teams/teams.dto.js';
import {
  AdminCreateTeamDto,
  CreateInvitationDto,
  RemoveMemberDto,
  RevokeInvitationDto,
  TeamInvitationDto,
  TeamManageDto,
  TransferCaptainDto,
} from './team-management.dto.js';
import { TeamManagementService } from './team-management.service.js';

@ApiTags('teams')
@Controller('teams')
export class TeamManagementController {
  constructor(private readonly management: TeamManagementService) {}

  @Get(':slug/manage')
  @Authenticated()
  @ApiOperation({
    summary: 'Team management view (captain, TEAM_MANAGER of the team, SUPER_ADMIN)',
  })
  @ApiOkResponse({ type: TeamManageDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'FORBIDDEN_ROLE (not an operator)' })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  manage(
    @Param('slug', new SlugParamPipe('Team')) slug: string,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<TeamManageDto> {
    return this.management.manage(slug, auth.userId, auditContextOf(req));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(['SUPER_ADMIN'], { unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Create a team directly with a captain (SUPER_ADMIN, audited)' })
  @ApiCreatedResponse({ type: TeamDetailDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'PLAYER_NOT_FOUND' })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      'TEAM_NAME_TAKEN | TEAM_TAG_TAKEN | ALREADY_IN_TEAM | APPLICANT_INELIGIBLE | SAMPLE_RESOURCE',
  })
  create(
    @CurrentUser() auth: AuthContext,
    @Body() dto: AdminCreateTeamDto,
    @Req() req: RequestWithIds,
  ): Promise<TeamDetailDto> {
    return this.management.createTeam(auth.userId, dto, auditContextOf(req));
  }

  @Post(':teamId/invitations')
  @HttpCode(HttpStatus.CREATED)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Invite a registered player by SteamID64 (team operator, audited)' })
  @ApiCreatedResponse({ type: TeamInvitationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Team not found | PLAYER_NOT_FOUND' })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      'ALREADY_MEMBER | INVITATION_ALREADY_PENDING | INVITATION_LIMIT | TEAM_NOT_ACTIVE | ' +
      'SAMPLE_RESOURCE',
  })
  invite(
    @Param('teamId', uuidParam('teamId')) teamId: string,
    @Body() dto: CreateInvitationDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<TeamInvitationDto> {
    return this.management.invite(auth.userId, teamId, dto, auditContextOf(req));
  }

  @Post(':teamId/invitations/:invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Revoke a pending invitation (team operator, audited)' })
  @ApiOkResponse({ type: TeamInvitationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'INVITATION_NOT_PENDING | INVITATION_EXPIRED | SAMPLE_RESOURCE',
  })
  revoke(
    @Param('teamId', uuidParam('teamId')) teamId: string,
    @Param('invitationId', uuidParam('invitationId')) invitationId: string,
    @Body() dto: RevokeInvitationDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<TeamInvitationDto> {
    return this.management.revoke(
      auth.userId,
      teamId,
      invitationId,
      dto.reason,
      auditContextOf(req),
    );
  }

  @Post(':teamId/members/:userId/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Remove a non-captain member (team operator, audited)' })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Team not found | NOT_TEAM_MEMBER' })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'CAPTAIN_MUST_TRANSFER | SAMPLE_RESOURCE',
  })
  async remove(
    @Param('teamId', uuidParam('teamId')) teamId: string,
    @Param('userId', uuidParam('userId')) userId: string,
    @Body() dto: RemoveMemberDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<void> {
    await this.management.removeMember(
      auth.userId,
      teamId,
      userId,
      dto.reason,
      auditContextOf(req),
    );
  }

  @Post(':teamId/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Leave the team (not allowed for the captain; audited)' })
  @ApiNoContentResponse({ description: 'Left' })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Team not found | NOT_TEAM_MEMBER' })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'CAPTAIN_MUST_TRANSFER | SAMPLE_RESOURCE',
  })
  async leave(
    @Param('teamId', uuidParam('teamId')) teamId: string,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<void> {
    await this.management.leave(auth.userId, teamId, auditContextOf(req));
  }

  @Post(':teamId/transfer-captain')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Transfer captaincy (current captain or SUPER_ADMIN; audited)' })
  @ApiOkResponse({ type: TeamDetailDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'FORBIDDEN_ROLE | CSRF_FAILED' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Team not found | NOT_TEAM_MEMBER' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'SAMPLE_RESOURCE' })
  transfer(
    @Param('teamId', uuidParam('teamId')) teamId: string,
    @Body() dto: TransferCaptainDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<TeamDetailDto> {
    return this.management.transferCaptain(
      auth.userId,
      teamId,
      dto.newCaptainUserId,
      auditContextOf(req),
    );
  }
}
