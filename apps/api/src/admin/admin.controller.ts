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
import {
  AdminUserPageDto,
  AdminUsersQueryDto,
  AuditLogPageDto,
  AuditQueryDto,
  GrantRoleDto,
  RevokeRoleDto,
  RoleGrantDto,
} from './admin.dto.js';
import { AdminService } from './admin.service.js';

@ApiTags('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @RequireRoles(['SUPER_ADMIN'])
  @ApiOperation({ summary: 'List users (search by nickname or exact SteamID64)' })
  @ApiOkResponse({ type: AdminUserPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  list(@Query() query: AdminUsersQueryDto): Promise<AdminUserPageDto> {
    return this.admin.listUsers(query);
  }

  @Post(':id/roles')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(['SUPER_ADMIN'], { unsafe: true })
  @ApiOperation({ summary: 'Grant a role (audited)' })
  @ApiCreatedResponse({ type: RoleGrantDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Active duplicate grant / sample user' })
  grant(
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: GrantRoleDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<RoleGrantDto> {
    return this.admin.grantRole(auth.userId, id, dto, auditContextOf(req));
  }

  @Post(':id/roles/:grantId/revoke')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(['SUPER_ADMIN'], { unsafe: true })
  @ApiOperation({ summary: 'Revoke a role grant (audited)' })
  @ApiOkResponse({ type: RoleGrantDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'Already revoked, own SUPER_ADMIN grant, or last SUPER_ADMIN',
  })
  revoke(
    @Param('id', uuidParam('id')) id: string,
    @Param('grantId', uuidParam('grantId')) grantId: string,
    @Body() dto: RevokeRoleDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<RoleGrantDto> {
    return this.admin.revokeRole(auth.userId, id, grantId, dto.reason, auditContextOf(req));
  }
}

@ApiTags('admin')
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @RequireRoles(['SUPER_ADMIN'])
  @ApiOperation({ summary: 'Audit log, newest first' })
  @ApiOkResponse({ type: AuditLogPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  list(@Query() query: AuditQueryDto): Promise<AuditLogPageDto> {
    return this.admin.listAudit(query);
  }
}
