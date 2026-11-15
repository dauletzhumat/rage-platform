import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { TeamRefDto, TournamentRefDto } from '../common/http/dto.js';
import { PageMetaDto, PaginationQueryDto } from '../common/pagination/pagination.js';
import { ReasonField } from '../team-domain/team-input.dto.js';
import { MAP_NAME_PATTERN } from '../tournament-domain/tournament-policy.js';
import { SERIES_STATUSES, type SeriesStatus } from './state-machine.js';

/** Series statuses (docs/TOURNAMENTS.md §7). KNIFE / MAP_FINISHED are map states since M3. */
export const MATCH_STATUSES = SERIES_STATUSES;
export type MatchStatusValue = SeriesStatus;

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

export const MATCH_RESULT_SOURCES = ['SERVER', 'ADMIN_OVERRIDE', 'FORFEIT'] as const;
export type MatchResultSourceValue = (typeof MATCH_RESULT_SOURCES)[number];

/** Team reference in match / bracket views; the id is needed for veto turns and results. */
export class MatchTeamRefDto extends TeamRefDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}

export class MatchRoundDto {
  @ApiProperty({ minimum: 1 }) roundNumber!: number;
  @ApiProperty({ example: 'Semifinals' }) name!: string;
}

export class MatchSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: MATCH_STATUSES, enumName: 'MatchStatus' }) status!: MatchStatusValue;
  @ApiProperty({ enum: MATCH_FORMATS, enumName: 'MatchFormat' }) format!: MatchFormatValue;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) scheduledAt!: string | null;
  @ApiProperty({
    type: MatchTeamRefDto,
    nullable: true,
    description: 'Null while a bracket slot is TBD',
  })
  teamA!: MatchTeamRefDto | null;
  @ApiProperty({ type: MatchTeamRefDto, nullable: true }) teamB!: MatchTeamRefDto | null;
  @ApiProperty({ type: TournamentRefDto, nullable: true }) tournament!: TournamentRefDto | null;
  @ApiProperty({
    type: MatchRoundDto,
    nullable: true,
    description: 'Bracket round of the match (null outside a bracket)',
  })
  round!: MatchRoundDto | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Series score = maps won (not rounds). Null until a result exists; always null for FORFEIT',
  })
  teamAScore!: number | null;
  @ApiProperty({ type: Number, nullable: true }) teamBScore!: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Published winner: a COMPLETED match with an admin result (ADMIN_OVERRIDE / FORFEIT, ' +
      'labelled by `resultSource`) or a verified server result',
  })
  winnerTeamSlug!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) winnerTeamId!: string | null;
  @ApiProperty({
    enum: MATCH_RESULT_SOURCES,
    enumName: 'MatchResultSource',
    nullable: true,
    description:
      'SERVER = server-confirmed; ADMIN_OVERRIDE / FORFEIT = audited admin action, never ' +
      'server-verified ("Admin result")',
  })
  resultSource!: MatchResultSourceValue | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Set only for server-verified results (always null for admin results)',
  })
  resultVerifiedAt!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: '`bye` for a round-1 bye slot; `tournament_cancelled`; otherwise null',
  })
  statusReason!: string | null;
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

// ---------------------------------------------------------------------------------------------
// Veto (§8)
// ---------------------------------------------------------------------------------------------

export const VETO_ACTION_TYPES = ['BAN', 'PICK', 'DECIDER'] as const;
export const VETO_TURN_ACTIONS = ['BAN', 'PICK'] as const;
export type VetoTurnActionValue = (typeof VETO_TURN_ACTIONS)[number];

export class VetoActionDto {
  @ApiProperty({ minimum: 1 }) sequence!: number;
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Acting team; null for the server-inserted DECIDER',
  })
  teamId!: string | null;
  @ApiProperty({ enum: VETO_ACTION_TYPES, enumName: 'VetoAction' })
  action!: (typeof VETO_ACTION_TYPES)[number];
  @ApiProperty({ example: 'de_mirage' }) mapName!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class VetoNextDto {
  @ApiProperty({ format: 'uuid' }) teamId!: string;
  @ApiProperty({ enum: VETO_TURN_ACTIONS, enumName: 'VetoTurnAction' })
  action!: VetoTurnActionValue;
}

export class VetoStateDto {
  @ApiProperty({ type: [String], description: 'Tournament map pool (7 maps)' }) pool!: string[];
  @ApiProperty({ type: [VetoActionDto] }) actions!: VetoActionDto[];
  @ApiProperty({
    type: VetoNextDto,
    nullable: true,
    description: 'Whose turn it is; null when complete or not possible (teams TBD)',
  })
  next!: VetoNextDto | null;
  @ApiProperty({ type: [String] }) remaining!: string[];
  @ApiProperty() complete!: boolean;
}

export class SubmitVetoDto {
  @ApiProperty({ enum: VETO_TURN_ACTIONS, enumName: 'VetoTurnAction' })
  @IsIn(VETO_TURN_ACTIONS)
  action!: VetoTurnActionValue;

  @ApiProperty({ example: 'de_mirage', pattern: MAP_NAME_PATTERN.source })
  @IsString()
  @Matches(MAP_NAME_PATTERN, { message: 'mapName must match ^de_[a-z0-9_]{2,30}$' })
  mapName!: string;
}

// ---------------------------------------------------------------------------------------------
// Admin results (§9)
// ---------------------------------------------------------------------------------------------

export class ResultOverrideDto {
  @ApiProperty({ format: 'uuid', description: 'Team A or team B of the match' })
  @IsUUID()
  winnerTeamId!: string;

  @ApiProperty({ minimum: 0, maximum: 3, description: 'Maps won by team A' })
  @IsInt()
  @Min(0)
  @Max(3)
  teamAScore!: number;

  @ApiProperty({ minimum: 0, maximum: 3, description: 'Maps won by team B' })
  @IsInt()
  @Min(0)
  @Max(3)
  teamBScore!: number;

  @ReasonField('Why the result is entered by an admin (audited; not server-verified)')
  reason!: string;
}

export class ForfeitDto {
  @ApiProperty({ format: 'uuid', description: 'Team that forfeits; the other team wins' })
  @IsUUID()
  forfeitingTeamId!: string;

  @ReasonField('Forfeit reason (audited)')
  reason!: string;
}

export class AdminMatchesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  tournamentId?: string;

  @ApiPropertyOptional({ enum: MATCH_STATUSES, enumName: 'MatchStatus' })
  @IsOptional()
  @IsIn(MATCH_STATUSES)
  status?: MatchStatusValue;
}
