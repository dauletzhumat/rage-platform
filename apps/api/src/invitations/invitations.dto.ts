import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvitationStatus } from '@rage/db';
import { IsEnum, IsOptional } from 'class-validator';
import { INVITATION_ROLES, type InvitationRole } from '../team-domain/team-policy.js';

export class MyInvitationsQueryDto {
  @ApiPropertyOptional({ enum: InvitationStatus, enumName: 'InvitationStatus', default: 'PENDING' })
  @IsOptional()
  @IsEnum(InvitationStatus)
  status: InvitationStatus = 'PENDING';
}

export class MyInvitationTeamDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() tag!: string;
}

export class MyInvitationInviterDto {
  @ApiProperty() nickname!: string;
}

export class MyInvitationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: InvitationStatus, enumName: 'InvitationStatus' }) status!: InvitationStatus;
  @ApiProperty({ enum: INVITATION_ROLES, enumName: 'InvitationRole' }) role!: InvitationRole;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) respondedAt!: string | null;
  @ApiProperty({ type: MyInvitationTeamDto }) team!: MyInvitationTeamDto;
  @ApiProperty({ type: MyInvitationInviterDto }) invitedBy!: MyInvitationInviterDto;
}
