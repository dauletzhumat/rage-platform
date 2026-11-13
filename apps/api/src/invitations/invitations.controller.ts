import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
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
import { MyInvitationDto, MyInvitationsQueryDto } from './invitations.dto.js';
import { InvitationsService } from './invitations.service.js';

@ApiTags('me')
@Controller('me/invitations')
export class MyInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @Authenticated()
  @ApiOperation({
    summary: 'Own team invitations by status (default PENDING), newest first, max 50',
  })
  @ApiOkResponse({ type: [MyInvitationDto] })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  list(
    @CurrentUser() auth: AuthContext,
    @Query() query: MyInvitationsQueryDto,
    @Req() req: RequestWithIds,
  ): Promise<MyInvitationDto[]> {
    return this.invitations.listMine(auth.userId, query.status, auditContextOf(req));
  }
}

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Accept an invitation (invitee only; others get 404). No request body.',
  })
  @ApiOkResponse({ type: MyInvitationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      'INVITATION_NOT_PENDING | INVITATION_EXPIRED | TEAM_NOT_ACTIVE | ALREADY_IN_TEAM | ' +
      'ROSTER_FULL | SAMPLE_RESOURCE',
  })
  accept(
    @Param('id', uuidParam('id')) id: string,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<MyInvitationDto> {
    return this.invitations.accept(auth.userId, id, auditContextOf(req));
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Decline an invitation (invitee only; others get 404). No body.' })
  @ApiOkResponse({ type: MyInvitationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'INVITATION_NOT_PENDING | INVITATION_EXPIRED | SAMPLE_RESOURCE',
  })
  decline(
    @Param('id', uuidParam('id')) id: string,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<MyInvitationDto> {
    return this.invitations.decline(auth.userId, id, auditContextOf(req));
  }
}
