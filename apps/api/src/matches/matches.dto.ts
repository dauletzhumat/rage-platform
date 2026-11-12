import { ApiProperty } from '@nestjs/swagger';
import { TeamRefDto, TournamentRefDto } from '../common/http/dto.js';
import { PageMetaDto } from '../common/pagination/pagination.js';

export const MATCH_STATUSES = [
  'CREATED',
  'SERVER_ASSIGNED',
  'PREPARING',
  'WARMUP',
  'READY_CHECK',
  'KNIFE',
  'LIVE',
  'PAUSED',
  'MAP_FINISHED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'DISPUTED',
] as const;
export type MatchStatusValue = (typeof MATCH_STATUSES)[number];

export const MATCH_MAP_STATUSES = [
  'PENDING',
  'WARMUP',
  'KNIFE',
  'LIVE',
  'PAUSED',
  'FINISHED',
  'CANCELLED',
] as const;
export type MatchMapStatusValue = (typeof MATCH_MAP_STATUSES)[number];

export const MATCH_FORMATS = ['BO1', 'BO3', 'BO5'] as const;
export type MatchFormatValue = (typeof MATCH_FORMATS)[number];

export class MatchSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: MATCH_STATUSES, enumName: 'MatchStatus' }) status!: MatchStatusValue;
  @ApiProperty({ enum: MATCH_FORMATS, enumName: 'MatchFormat' }) format!: MatchFormatValue;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) scheduledAt!: string | null;
  @ApiProperty({
    type: TeamRefDto,
    nullable: true,
    description: 'Null while a bracket slot is TBD',
  })
  teamA!: TeamRefDto | null;
  @ApiProperty({ type: TeamRefDto, nullable: true }) teamB!: TeamRefDto | null;
  @ApiProperty({ type: TournamentRefDto, nullable: true }) tournament!: TournamentRefDto | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Only set once the result is server-confirmed and verified',
  })
  winnerTeamSlug!: string | null;
  @ApiProperty() isSample!: boolean;
}

export class MatchMapDto {
  @ApiProperty({ minimum: 1 }) mapOrder!: number;
  @ApiProperty({ example: 'de_mirage' })
  mapName!: string;
  @ApiProperty({ enum: MATCH_MAP_STATUSES, enumName: 'MatchMapStatus' })
  status!: MatchMapStatusValue;
  @ApiProperty({ type: Number, nullable: true }) teamAScore!: number | null;
  @ApiProperty({ type: Number, nullable: true }) teamBScore!: number | null;
}

export class MatchDetailDto extends MatchSummaryDto {
  @ApiProperty({ type: [MatchMapDto] }) maps!: MatchMapDto[];
}

export class MatchPageDto extends PageMetaDto {
  @ApiProperty({ type: [MatchSummaryDto] }) items!: MatchSummaryDto[];
}
