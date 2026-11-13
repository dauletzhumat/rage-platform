import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { auditContextOf } from '../audit/audit.service.js';
import { Authenticated } from '../auth/auth.decorators.js';
import { CurrentUser } from '../auth/guards.js';
import type { AuthContext } from '../auth/session.service.js';
import { ApiErrorDto } from '../common/errors/api-error.js';
import type { RequestWithIds } from '../common/http/request-id.js';
import { MeDto, UpdateMyProfileDto } from './me.dto.js';
import { MeService } from './me.service.js';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: 'Current user (identity, profile, Steam profile, active roles)' })
  @ApiOkResponse({ type: MeDto })
  get(@CurrentUser() auth: AuthContext): Promise<MeDto> {
    return this.me.get(auth.userId);
  }

  @Patch('profile')
  @Authenticated({ unsafe: true })
  @ApiOperation({ summary: 'Update own nickname / country / biography (audited)' })
  @ApiOkResponse({ type: MeDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  update(
    @CurrentUser() auth: AuthContext,
    @Body() dto: UpdateMyProfileDto,
    @Req() req: RequestWithIds,
  ): Promise<MeDto> {
    return this.me.updateProfile(auth.userId, dto, auditContextOf(req));
  }
}
