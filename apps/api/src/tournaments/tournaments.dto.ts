import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PageMetaDto, SearchPaginationQueryDto } from '../common/pagination/pagination.js';

/** Statuses visible publicly. DRAFT tournaments are never exposed. */
export const PUBLIC_TOURNAMENT_STATUSES = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export const TOURNAMENT_STATUSES = ['DRAFT', ...PUBLIC_TOURNAMENT_STATUSES] as const;
export type TournamentStatusValue = (typeof TOURNAMENT_STATUSES)[number];
export type PublicTournamentStatus = (typeof PUBLIC_TOURNAMENT_STATUSES)[number];

export class TournamentListQueryDto extends SearchPaginationQueryDto {
  @ApiPropertyOptional({ enum: PUBLIC_TOURNAMENT_STATUSES })
  @IsOptional()
  @IsIn(PUBLIC_TOURNAMENT_STATUSES)
  status?: PublicTournamentStatus;
}

export class TournamentSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 'SINGLE_ELIMINATION' }) format!: string;
  @ApiProperty({ enum: TOURNAMENT_STATUSES, enumName: 'TournamentStatus' })
  status!: TournamentStatusValue;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startsAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  registrationOpenAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  registrationCloseAt!: string | null;
  @ApiProperty() isSample!: boolean;
}

export class TournamentDetailDto extends TournamentSummaryDto {
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ minimum: 0, description: 'Registrations approved by a tournament admin' })
  registeredTeamCount!: number;
}

export class TournamentPageDto extends PageMetaDto {
  @ApiProperty({ type: [TournamentSummaryDto] }) items!: TournamentSummaryDto[];
}
