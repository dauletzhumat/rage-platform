import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoleScopeType, RoleType, UserStatus } from '@rage/db';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
import {
  PageMetaDto,
  PaginationQueryDto,
  SearchPaginationQueryDto,
} from '../common/pagination/pagination.js';

export class RoleGrantDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: RoleType, enumName: 'RoleType' }) role!: RoleType;
  @ApiProperty({ enum: RoleScopeType, enumName: 'RoleScopeType' }) scopeType!: RoleScopeType;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) scopeId!: string | null;
  @ApiProperty({ format: 'date-time' }) issuedAt!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'null = bootstrap' })
  issuedById!: string | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) revokedAt!: string | null;
}

export class AdminUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '76561198000000000' }) steamId64!: string;
  @ApiProperty({ enum: UserStatus, enumName: 'UserStatus' }) status!: UserStatus;
  @ApiProperty({ description: 'Clearly-labelled demo/seed account (ADR-011)' }) isSample!: boolean;
  @ApiProperty({ type: String, nullable: true }) nickname!: string | null;
  @ApiProperty({ type: String, nullable: true }) slug!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastLoginAt!: string | null;
  @ApiProperty({
    type: [RoleGrantDto],
    description: 'All grants, active and revoked (revokedAt set), newest first',
  })
  roles!: RoleGrantDto[];
}

export class AdminUserPageDto extends PageMetaDto {
  @ApiProperty({ type: [AdminUserDto] }) items!: AdminUserDto[];
}

export class AdminUsersQueryDto extends SearchPaginationQueryDto {}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class GrantRoleDto {
  @ApiProperty({ enum: RoleType, enumName: 'RoleType' })
  @IsEnum(RoleType)
  role!: RoleType;

  @ApiProperty({ enum: RoleScopeType, enumName: 'RoleScopeType' })
  @IsEnum(RoleScopeType)
  scopeType!: RoleScopeType;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Required for non-GLOBAL scopes; must be absent/null for GLOBAL',
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsUUID()
  scopeId?: string | null;

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class RevokeRoleDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class AuditLogDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'role_grant.create' }) action!: string;
  @ApiProperty({ example: 'user_role_grant' }) resourceType!: string;
  @ApiProperty({ type: String, nullable: true }) resourceId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) actorUserId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Server-generated request id' })
  requestId!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) detail!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class AuditLogPageDto extends PageMetaDto {
  @ApiProperty({ type: [AuditLogDto] }) items!: AuditLogDto[];
}

export class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'auth.login', maxLength: 96 })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z_]{1,48}(\.[a-z_]{1,46})*$/, { message: 'action must be a dotted action code' })
  action?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;
}
