import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TeamApplicationStatus } from '@rage/db';
import { IsEnum, IsOptional } from 'class-validator';
import { PageMetaDto, PaginationQueryDto } from '../common/pagination/pagination.js';
import {
  OptionalReasonField,
  ReasonField,
  TeamIdentityInputDto,
} from '../team-domain/team-input.dto.js';

export class CreateTeamApplicationDto extends TeamIdentityInputDto {}

export class ApproveTeamApplicationDto {
  @OptionalReasonField('Optional note to the applicant (stored as reviewReason, audited)')
  note?: string | null;
}

export class RejectTeamApplicationDto {
  @ReasonField('Shown to the applicant; audited')
  reason!: string;
}

export class AdminTeamApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: TeamApplicationStatus,
    enumName: 'TeamApplicationStatus',
    default: 'PENDING',
  })
  @IsOptional()
  @IsEnum(TeamApplicationStatus)
  status: TeamApplicationStatus = 'PENDING';
}

export class TeamApplicationCreatedTeamDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
}

export class TeamApplicationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() tag!: string;
  @ApiProperty({
    description: 'Requested slug (derived server-side; the team may get a suffixed slug)',
  })
  slug!: string;
  @ApiProperty({ type: String, nullable: true }) countryCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ enum: TeamApplicationStatus, enumName: 'TeamApplicationStatus' })
  status!: TeamApplicationStatus;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Reject reason (or optional approval note); visible to the applicant',
  })
  reviewReason!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reviewedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: TeamApplicationCreatedTeamDto, nullable: true })
  createdTeam!: TeamApplicationCreatedTeamDto | null;
}

export class TeamApplicantDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ example: '76561198000000000' }) steamId64!: string;
  @ApiProperty() nickname!: string;
  @ApiProperty() playerSlug!: string;
}

export class AdminTeamApplicationDto extends TeamApplicationDto {
  @ApiProperty({ type: TeamApplicantDto }) applicant!: TeamApplicantDto;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) reviewedById!: string | null;
  @ApiProperty({ description: 'Sample/demo data (the applicant is a sample account)' })
  isSample!: boolean;
}

export class AdminTeamApplicationPageDto extends PageMetaDto {
  @ApiProperty({ type: [AdminTeamApplicationDto] }) items!: AdminTeamApplicationDto[];
}
