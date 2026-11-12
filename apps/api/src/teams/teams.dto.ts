import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../common/pagination/pagination.js';

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
  @ApiProperty() playerSlug!: string;
  @ApiProperty() nickname!: string;
  @ApiProperty({ type: String, nullable: true }) countryCode!: string | null;
  @ApiProperty({ enum: MEMBERSHIP_ROLES, enumName: 'MembershipRole' }) role!: MembershipRoleValue;
  @ApiProperty({ format: 'date-time' }) joinedAt!: string;
}

export class TeamDetailDto extends TeamSummaryDto {
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [TeamRosterEntryDto], description: 'Current (active) memberships' })
  roster!: TeamRosterEntryDto[];
}

export class TeamPageDto extends PageMetaDto {
  @ApiProperty({ type: [TeamSummaryDto] }) items!: TeamSummaryDto[];
}
