import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoleScopeType, RoleType, UserStatus } from '@rage/db';
import { Transform } from 'class-transformer';
import {
  IsISO31661Alpha2,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { M2_MEMBERSHIP_ROLES, type M2MembershipRole } from '../team-domain/team-policy.js';
import {
  NICKNAME_MAX,
  NICKNAME_MIN,
  NICKNAME_PATTERN,
  VISIBLE_TEXT_PATTERN,
} from '../auth/profile-rules.js';

export class MeUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({
    description: 'Verified SteamID64 (immutable identity)',
    example: '76561198000000000',
  })
  steamId64!: string;
  @ApiProperty({ enum: UserStatus, enumName: 'UserStatus' }) status!: UserStatus;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastLoginAt!: string | null;
}

export class MeProfileDto {
  @ApiProperty() slug!: string;
  @ApiProperty() nickname!: string;
  @ApiProperty({ type: String, nullable: true, example: 'KZ' }) countryCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) biography!: string | null;
}

export class MeSteamProfileDto {
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'https Steam CDN URL only' })
  avatarUrl!: string | null;
  @ApiProperty({ type: String, nullable: true }) profileUrl!: string | null;
}

export class MeRoleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: RoleType, enumName: 'RoleType' }) role!: RoleType;
  @ApiProperty({ enum: RoleScopeType, enumName: 'RoleScopeType' }) scopeType!: RoleScopeType;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) scopeId!: string | null;
  @ApiProperty({ format: 'date-time' }) issuedAt!: string;
}

export class MeMembershipDto {
  @ApiProperty({ format: 'uuid' }) teamId!: string;
  @ApiProperty() teamSlug!: string;
  @ApiProperty() teamName!: string;
  @ApiProperty({ enum: M2_MEMBERSHIP_ROLES, enumName: 'TeamMembershipRole' })
  role!: M2MembershipRole;
  @ApiProperty({ format: 'date-time' }) joinedAt!: string;
}

export class MeDto {
  @ApiProperty({ type: MeUserDto }) user!: MeUserDto;
  @ApiProperty({ type: MeProfileDto }) profile!: MeProfileDto;
  @ApiProperty({ type: MeSteamProfileDto, nullable: true }) steamProfile!: MeSteamProfileDto | null;
  @ApiProperty({ type: [MeRoleDto], description: 'Active role grants' }) roles!: MeRoleDto[];
  @ApiProperty({
    type: MeMembershipDto,
    nullable: true,
    description: 'Active team membership (one per user, ADR-019) or null',
  })
  membership!: MeMembershipDto | null;
}

/** NFC so visually identical nicknames compare equal (security gate M1, L-5). */
const trimNfc = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.normalize('NFC').trim() : value;
/**
 * Biography: newline and tab allowed; other C0/C1 controls and bidi overrides/isolates (which can
 * visually reorder text on public pages) are rejected (security gate M1, L-5).
 */
export const BIOGRAPHY_PATTERN =
  // eslint-disable-next-line no-control-regex
  /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;

export class UpdateMyProfileDto {
  @ApiPropertyOptional({ minLength: NICKNAME_MIN, maxLength: NICKNAME_MAX, example: 'player_one' })
  // Not @IsOptional: that would also accept `null`, and nickname cannot be cleared.
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trimNfc)
  @IsString()
  @Length(NICKNAME_MIN, NICKNAME_MAX)
  @Matches(NICKNAME_PATTERN, {
    message: 'nickname may contain letters, digits, spaces, "_", "." and "-" only',
  })
  @Matches(VISIBLE_TEXT_PATTERN, {
    message: 'nickname must contain a visible letter or digit and no invisible characters',
  })
  nickname?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'ISO 3166-1 alpha-2, uppercase; null clears it',
    example: 'KZ',
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be two uppercase letters' })
  @IsISO31661Alpha2()
  countryCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.normalize('NFC') : value,
  )
  @IsString()
  @MaxLength(500)
  @Matches(BIOGRAPHY_PATTERN, {
    message: 'biography must not contain control or text-direction override characters',
  })
  biography?: string | null;
}
