import { ApiProperty } from '@nestjs/swagger';
import { InvitationStatus } from '@rage/db';
import { IsIn, IsString, IsUUID, Matches } from 'class-validator';
import { TeamDetailDto } from '../teams/teams.dto.js';
import { OptionalReasonField, ReasonField } from '../team-domain/team-input.dto.js';
import { INVITATION_ROLES, type InvitationRole } from '../team-domain/team-policy.js';

export class CreateInvitationDto {
  @ApiProperty({
    example: '76561198000000000',
    description: 'SteamID64 of a registered player (must have signed in once)',
  })
  @IsString()
  @Matches(/^\d{17}$/, { message: 'steamId64 must be 17 digits' })
  steamId64!: string;

  @ApiProperty({ enum: INVITATION_ROLES, enumName: 'InvitationRole' })
  @IsIn(INVITATION_ROLES)
  role!: InvitationRole;
}

export class RevokeInvitationDto {
  @OptionalReasonField('Optional reason (audit only, never public)')
  reason?: string | null;
}

export class RemoveMemberDto {
  @ReasonField('Audit only, never shown publicly')
  reason!: string;
}

export class TransferCaptainDto {
  @ApiProperty({ format: 'uuid', description: 'Active member of the same team' })
  @IsUUID()
  newCaptainUserId!: string;
}

export class InvitationInviteeDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ example: '76561198000000000' }) steamId64!: string;
  @ApiProperty() nickname!: string;
  @ApiProperty() playerSlug!: string;
}

export class InvitationInviterDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() nickname!: string;
}

export class TeamInvitationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: InvitationStatus, enumName: 'InvitationStatus' }) status!: InvitationStatus;
  @ApiProperty({ enum: INVITATION_ROLES, enumName: 'InvitationRole' }) role!: InvitationRole;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) respondedAt!: string | null;
  @ApiProperty({ type: InvitationInviteeDto }) invitee!: InvitationInviteeDto;
  @ApiProperty({ type: InvitationInviterDto }) invitedBy!: InvitationInviterDto;
}

export class TeamManagePermissionsDto {
  @ApiProperty() canInvite!: boolean;
  @ApiProperty({ description: 'Remove non-captain members' }) canRemove!: boolean;
  @ApiProperty({ description: 'Captain or SUPER_ADMIN only' }) canTransfer!: boolean;
}

export class TeamManageDto {
  @ApiProperty({ type: TeamDetailDto }) team!: TeamDetailDto;
  @ApiProperty({ type: [TeamInvitationDto] }) pendingInvitations!: TeamInvitationDto[];
  @ApiProperty({ type: TeamManagePermissionsDto }) permissions!: TeamManagePermissionsDto;
  @ApiProperty({ example: 7 }) rosterCap!: number;
  @ApiProperty({ example: 10 }) pendingInvitationCap!: number;
}
