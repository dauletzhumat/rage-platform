import { ApiProperty } from '@nestjs/swagger';
import { TeamStatus } from '@rage/db';
import { PageMetaDto } from '../common/pagination/pagination.js';
import {
  LEFT_REASONS,
  type LeftReason,
  M2_MEMBERSHIP_ROLES,
  type M2MembershipRole,
} from '../team-domain/team-policy.js';

export const MEMBERSHIP_ROLES = ['CAPTAIN', 'PLAYER', 'SUBSTITUTE', 'MANAGER', 'COACH'] as const;
export type MembershipRoleValue = (typeof MEMBERSHIP_ROLES)[number];

export class TeamSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() tag!: string;
  @ApiProperty({ type: String, nullable: true }) countryCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) region!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null until object storage lands (M5+)',
  })
  logoUrl!: string | null;
  @ApiProperty() isSample!: boolean;
  @ApiProperty({ minimum: 0 }) activeMemberCount!: number;
}

export class TeamRosterEntryDto {
  @ApiProperty({
    format: 'uuid',
    description: 'User id (needed for remove / transfer; not secret)',
  })
  userId!: string;
  @ApiProperty() playerSlug!: string;
  @ApiProperty() nickname!: string;
  @ApiProperty({ type: String, nullable: true }) countryCode!: string | null;
  @ApiProperty({ enum: MEMBERSHIP_ROLES, enumName: 'MembershipRole' }) role!: MembershipRoleValue;
  @ApiProperty({ format: 'date-time' }) joinedAt!: string;
}

export class TeamDetailDto extends TeamSummaryDto {
  @ApiProperty({
    enum: TeamStatus,
    enumName: 'TeamStatus',
    description: 'ACTIVE, or INACTIVE/DISBANDED (archived page; not listed in /teams)',
  })
  status!: TeamStatus;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [TeamRosterEntryDto], description: 'Current (active) memberships' })
  roster!: TeamRosterEntryDto[];
}

export class TeamPageDto extends PageMetaDto {
  @ApiProperty({ type: [TeamSummaryDto] }) items!: TeamSummaryDto[];
}

/** One membership row of the public roster history (never rewritten; TEAMS.md §1). */
export class RosterHistoryEntryDto {
  @ApiProperty() playerSlug!: string;
  @ApiProperty() nickname!: string;
  @ApiProperty({ enum: M2_MEMBERSHIP_ROLES, enumName: 'TeamMembershipRole' })
  role!: M2MembershipRole;
  @ApiProperty({ format: 'date-time' }) joinedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) leftAt!: string | null;
  @ApiProperty({
    enum: LEFT_REASONS,
    enumName: 'RosterLeftReason',
    nullable: true,
    description: 'Enumerated reason only; free-text reasons are never public',
  })
  leftReason!: LeftReason | null;
}

export class RosterHistoryPageDto extends PageMetaDto {
  @ApiProperty({ type: [RosterHistoryEntryDto] }) items!: RosterHistoryEntryDto[];
}
