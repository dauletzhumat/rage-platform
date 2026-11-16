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
import { RequireRoles } from '../auth/auth.decorators.js';
import { CurrentUser } from '../auth/guards.js';
import type { AuthContext } from '../auth/session.service.js';
import { ApiErrorDto } from '../common/errors/api-error.js';
import { uuidParam } from '../common/http/params.js';
import type { RequestWithIds } from '../common/http/request-id.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import {
  BannedSteamIdDto,
  BannedSteamIdPageDto,
  CreateSteamBanDto,
  LiftSteamBanDto,
  SteamBansQueryDto,
} from './steam-bans.dto.js';
import { SteamBansService } from './steam-bans.service.js';

@ApiTags('admin')
@Controller('admin/banned-steam-ids')
export class AdminSteamBansController {
  constructor(private readonly bans: SteamBansService) {}

  @Get()
  @RequireRoles(['SUPER_ADMIN'])
  @ApiOperation({ summary: 'SteamID64 bans, newest first (SUPER_ADMIN)' })
  @ApiOkResponse({ type: BannedSteamIdPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  list(@Query() query: SteamBansQueryDto): Promise<BannedSteamIdPageDto> {
    return this.bans.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(['SUPER_ADMIN'], { unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Ban a SteamID64 from tournament rosters (SUPER_ADMIN; audited)' })
  @ApiCreatedResponse({ type: BannedSteamIdDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'STEAM_ID_ALREADY_BANNED' })
  create(
    @Body() dto: CreateSteamBanDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<BannedSteamIdDto> {
    return this.bans.create(auth.userId, dto, auditContextOf(req));
  }

  @Post(':id/lift')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(['SUPER_ADMIN'], { unsafe: true })
  @Idempotent()
  @ApiOperation({ summary: 'Lift an active ban (SUPER_ADMIN; audited)' })
  @ApiOkResponse({ type: BannedSteamIdDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'INVALID_STATE_TRANSITION (already lifted)',
  })
  lift(
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: LiftSteamBanDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<BannedSteamIdDto> {
    return this.bans.lift(auth.userId, id, dto.reason, auditContextOf(req));
  }
}
