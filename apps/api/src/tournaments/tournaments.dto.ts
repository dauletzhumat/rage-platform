import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RosterEntryRole } from '@rage/db';
import { IsIn, IsOptional } from 'class-validator';
import { PageMetaDto, SearchPaginationQueryDto } from '../common/pagination/pagination.js';
import {
  MATCH_FORMATS,
  type MatchFormatValue,
  MatchSummaryDto,
  MatchTeamRefDto,
} from '../matches/matches.dto.js';

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
  @ApiProperty({ minimum: 0, description: 'Same as registeredTeamCount (M3 name)' })
  approvedTeamCount!: number;
  @ApiProperty({ type: [String], description: 'Admin-supplied map pool (7 maps; empty if unset)' })
  mapPool!: string[];
  @ApiProperty({ enum: MATCH_FORMATS, enumName: 'MatchFormat' })
  defaultMatchFormat!: MatchFormatValue;
  @ApiProperty({ enum: MATCH_FORMATS, enumName: 'MatchFormat', nullable: true })
  finalMatchFormat!: MatchFormatValue | null;
  @ApiProperty({ type: Number, nullable: true }) maxTeams!: number | null;
  @ApiProperty({
    description: 'REGISTRATION_OPEN and now inside the optional registration window',
  })
  registrationOpen!: boolean;
}

export class PublicRosterEntryDto {
  @ApiProperty() playerSlug!: string;
  @ApiProperty({ description: 'Nickname snapshot at registration / substitution' })
  nicknameSnapshot!: string;
  @ApiProperty({ enum: RosterEntryRole, enumName: 'RosterEntryRole' }) role!: RosterEntryRole;
}

export class PublicTournamentRosterDto {
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lockedAt!: string | null;
  @ApiProperty({ type: [PublicRosterEntryDto] }) entries!: PublicRosterEntryDto[];
}

/** APPROVED registration with its current LOCKED roster (no SteamIDs). */
export class PublicTournamentTeamDto {
  @ApiProperty({ format: 'uuid' }) registrationId!: string;
  @ApiProperty({ type: Number, nullable: true }) seed!: number | null;
  @ApiProperty({ type: MatchTeamRefDto }) team!: MatchTeamRefDto;
  @ApiProperty() isSample!: boolean;
  @ApiProperty({ type: PublicTournamentRosterDto }) roster!: PublicTournamentRosterDto;
}

export class BracketMatchDto extends MatchSummaryDto {
  @ApiProperty({ minimum: 1 }) slotNumber!: number;
  @ApiProperty({ type: Number, nullable: true }) teamASeed!: number | null;
  @ApiProperty({ type: Number, nullable: true }) teamBSeed!: number | null;
  @ApiProperty({ description: 'Round-1 slot with a bye (CANCELLED, statusReason "bye")' })
  isBye!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Winner goes here' })
  nextMatchId!: string | null;
}

export class BracketRoundDto {
  @ApiProperty({ minimum: 1 }) roundNumber!: number;
  @ApiProperty({ example: 'Final' }) name!: string;
  @ApiProperty({ type: [BracketMatchDto] }) matches!: BracketMatchDto[];
}

export class BracketDto {
  @ApiProperty({ example: 'SINGLE_ELIMINATION' }) format!: string;
  @ApiProperty({ description: 'Bracket size (power of two)' }) size!: number;
  @ApiProperty({ type: [BracketRoundDto] }) rounds!: BracketRoundDto[];
}

export class TournamentPageDto extends PageMetaDto {
  @ApiProperty({ type: [TournamentSummaryDto] }) items!: TournamentSummaryDto[];
}
