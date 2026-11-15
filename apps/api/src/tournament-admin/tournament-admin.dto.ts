import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BracketFormat, RegistrationStatus, RosterEntryRole, TournamentStatus } from '@rage/db';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { VISIBLE_TEXT_PATTERN } from '../auth/profile-rules.js';
import { PageMetaDto, SearchPaginationQueryDto } from '../common/pagination/pagination.js';
import { PaginationQueryDto } from '../common/pagination/pagination.js';
import { MATCH_FORMATS, type MatchFormatValue } from '../matches/matches.dto.js';
import { BIOGRAPHY_PATTERN } from '../me/me.dto.js';
import { RegistrationDto } from '../registrations/registrations.dto.js';
import { OptionalReasonField, ReasonField } from '../team-domain/team-input.dto.js';
import { normalizeText, TEAM_NAME_PATTERN } from '../team-domain/team-policy.js';
import {
  MAP_NAME_PATTERN,
  MAP_POOL_SIZE,
  MAX_TEAMS_MAX,
  MAX_TEAMS_MIN,
  TOURNAMENT_DESCRIPTION_MAX,
  TOURNAMENT_NAME_MAX,
  TOURNAMENT_NAME_MIN,
} from '../tournament-domain/tournament-policy.js';

const BRACKET_FORMATS = Object.values(BracketFormat);
const emptyToNull = ({ value }: { value: unknown }) => {
  const v = normalizeText(value);
  return v === '' ? null : v;
};

/** `undefined` = not sent (PATCH: unchanged); `null` is rejected for non-nullable fields. */
const present = (_o: unknown, v: unknown) => v !== undefined;
const presentNonNull = (_o: unknown, v: unknown) => v !== undefined && v !== null;

function NameField(optional: boolean) {
  return applyDecorators(
    optional
      ? ApiPropertyOptional({ minLength: TOURNAMENT_NAME_MIN, maxLength: TOURNAMENT_NAME_MAX })
      : ApiProperty({
          minLength: TOURNAMENT_NAME_MIN,
          maxLength: TOURNAMENT_NAME_MAX,
          example: 'RAGE Autumn Cup',
          description: 'NFC, trimmed; team-name character rules; unique case-insensitively',
        }),
    Transform(({ value }: { value: unknown }) => normalizeText(value)),
    ...(optional ? [ValidateIf(present)] : []),
    IsString(),
    Length(TOURNAMENT_NAME_MIN, TOURNAMENT_NAME_MAX),
    Matches(TEAM_NAME_PATTERN, {
      message:
        'name must start with a letter or digit and contain only letters, digits, spaces, ".", "_" and "-"',
    }),
    Matches(VISIBLE_TEXT_PATTERN, {
      message: 'name must contain a visible letter or digit and no invisible characters',
    }),
  );
}

function MapPoolField(optional: boolean) {
  return applyDecorators(
    (optional ? ApiPropertyOptional : ApiProperty)({
      type: [String],
      minItems: MAP_POOL_SIZE,
      maxItems: MAP_POOL_SIZE,
      example: ['de_map_one', 'de_map_two', '…'],
      description: `Exactly ${MAP_POOL_SIZE} distinct map names ^de_[a-z0-9_]{2,30}$ (admin-supplied; no default pool)`,
    }),
    ...(optional ? [ValidateIf(present)] : []),
    IsArray(),
    ArrayMinSize(MAP_POOL_SIZE),
    ArrayMaxSize(MAP_POOL_SIZE),
    ArrayUnique(),
    IsString({ each: true }),
    Matches(MAP_NAME_PATTERN, { each: true, message: 'each map must match ^de_[a-z0-9_]{2,30}$' }),
  );
}

function DateField(description: string) {
  return applyDecorators(
    ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description }),
    ValidateIf(presentNonNull),
    IsISO8601({ strict: true }),
  );
}

export class CreateTournamentDto {
  @NameField(false)
  name!: string;

  @ApiProperty({
    enum: BRACKET_FORMATS,
    enumName: 'BracketFormat',
    description: 'Only SINGLE_ELIMINATION in M3 (others → 409 FORMAT_NOT_SUPPORTED)',
  })
  @IsIn(BRACKET_FORMATS)
  format!: BracketFormat;

  @ApiProperty({ enum: MATCH_FORMATS, enumName: 'MatchFormat' })
  @IsIn(MATCH_FORMATS)
  defaultMatchFormat!: MatchFormatValue;

  @ApiPropertyOptional({
    enum: MATCH_FORMATS,
    enumName: 'MatchFormat',
    nullable: true,
    description: 'Format of the final (defaults to defaultMatchFormat)',
  })
  @ValidateIf(presentNonNull)
  @IsIn(MATCH_FORMATS)
  finalMatchFormat?: MatchFormatValue | null;

  @ApiProperty({ minimum: MAX_TEAMS_MIN, maximum: MAX_TEAMS_MAX })
  @IsInt()
  @Min(MAX_TEAMS_MIN)
  @Max(MAX_TEAMS_MAX)
  maxTeams!: number;

  @DateField('Optional start of the registration window')
  registrationOpenAt?: string | null;

  @DateField('Optional end of the registration window (must be after registrationOpenAt)')
  registrationCloseAt?: string | null;

  @DateField('Optional scheduled start')
  startsAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: TOURNAMENT_DESCRIPTION_MAX })
  @Transform(emptyToNull)
  @ValidateIf(presentNonNull)
  @IsString()
  @MaxLength(TOURNAMENT_DESCRIPTION_MAX)
  @Matches(BIOGRAPHY_PATTERN, {
    message: 'description must not contain control or text-direction override characters',
  })
  description?: string | null;

  @MapPoolField(false)
  mapPool!: string[];
}

/** PATCH (JSON merge): absent = unchanged; `null` clears nullable fields. */
export class UpdateTournamentDto {
  @NameField(true)
  name?: string;

  @ApiPropertyOptional({ enum: BRACKET_FORMATS, enumName: 'BracketFormat' })
  @ValidateIf(present)
  @IsIn(BRACKET_FORMATS)
  format?: BracketFormat;

  @ApiPropertyOptional({ enum: MATCH_FORMATS, enumName: 'MatchFormat' })
  @ValidateIf(present)
  @IsIn(MATCH_FORMATS)
  defaultMatchFormat?: MatchFormatValue;

  @ApiPropertyOptional({ enum: MATCH_FORMATS, enumName: 'MatchFormat', nullable: true })
  @ValidateIf(presentNonNull)
  @IsIn(MATCH_FORMATS)
  finalMatchFormat?: MatchFormatValue | null;

  @ApiPropertyOptional({ minimum: MAX_TEAMS_MIN, maximum: MAX_TEAMS_MAX })
  @ValidateIf(present)
  @IsInt()
  @Min(MAX_TEAMS_MIN)
  @Max(MAX_TEAMS_MAX)
  maxTeams?: number;

  @DateField('Start of the registration window; null clears')
  registrationOpenAt?: string | null;

  @DateField('End of the registration window; null clears')
  registrationCloseAt?: string | null;

  @DateField('Scheduled start; null clears')
  startsAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: TOURNAMENT_DESCRIPTION_MAX })
  @Transform(emptyToNull)
  @ValidateIf(presentNonNull)
  @IsString()
  @MaxLength(TOURNAMENT_DESCRIPTION_MAX)
  @Matches(BIOGRAPHY_PATTERN, {
    message: 'description must not contain control or text-direction override characters',
  })
  description?: string | null;

  @MapPoolField(true)
  mapPool?: string[];
}

export class TournamentStatusChangeDto {
  @ApiProperty({ enum: TournamentStatus, enumName: 'TournamentStatus' })
  @IsIn(Object.values(TournamentStatus))
  to!: TournamentStatus;

  @OptionalReasonField('Required when cancelling (3-500 chars); audited')
  reason?: string | null;
}

export class AdminTournamentsQueryDto extends SearchPaginationQueryDto {
  @ApiPropertyOptional({ enum: TournamentStatus, enumName: 'TournamentStatus' })
  @IsOptional()
  @IsIn(Object.values(TournamentStatus))
  status?: TournamentStatus;
}

export class AdminTournamentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ enum: BRACKET_FORMATS, enumName: 'BracketFormat' }) format!: BracketFormat;
  @ApiProperty({ enum: TournamentStatus, enumName: 'TournamentStatus' })
  status!: TournamentStatus;
  @ApiProperty() isSample!: boolean;
  @ApiProperty({ enum: MATCH_FORMATS, enumName: 'MatchFormat' })
  defaultMatchFormat!: MatchFormatValue;
  @ApiProperty({ enum: MATCH_FORMATS, enumName: 'MatchFormat', nullable: true })
  finalMatchFormat!: MatchFormatValue | null;
  @ApiProperty({ type: Number, nullable: true }) maxTeams!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  registrationOpenAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  registrationCloseAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startsAt!: string | null;
  @ApiProperty({ type: [String] }) mapPool!: string[];
  @ApiProperty({ minimum: 0 }) approvedTeamCount!: number;
  @ApiProperty({ minimum: 0 }) pendingRegistrationCount!: number;
  @ApiProperty({ description: 'True once generate-bracket has run' }) bracketGenerated!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class AdminTournamentPageDto extends PageMetaDto {
  @ApiProperty({ type: [AdminTournamentDto] }) items!: AdminTournamentDto[];
}

// ---------------------------------------------------------------------------------------------
// Registrations (admin)
// ---------------------------------------------------------------------------------------------

export class AdminRegistrationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RegistrationStatus, enumName: 'RegistrationStatus' })
  @IsOptional()
  @IsIn(Object.values(RegistrationStatus))
  status?: RegistrationStatus;
}

export class AdminRegistrationDto extends RegistrationDto {
  @ApiProperty({ description: 'Sample team (never mutated)' }) isSample!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reviewedAt!: string | null;
}

export class AdminRegistrationPageDto extends PageMetaDto {
  @ApiProperty({ type: [AdminRegistrationDto] }) items!: AdminRegistrationDto[];
}

export class ApproveRegistrationDto {
  @OptionalReasonField('Optional note (stored as review reason, visible to the team)')
  note?: string | null;
}

export class RejectRegistrationDto {
  @ReasonField('Visible to the team operators')
  reason!: string;
}

export class SubstituteRegistrationDto {
  @ApiProperty({ format: 'uuid', description: 'Player leaving the locked roster' })
  @IsUUID()
  outUserId!: string;

  @ApiProperty({ format: 'uuid', description: 'Eligible current team member joining' })
  @IsUUID()
  inUserId!: string;

  @ApiProperty({
    enum: RosterEntryRole,
    enumName: 'RosterEntryRole',
    description: 'Role of the incoming player (must keep 5 starters / ≤ 2 substitutes)',
  })
  @IsIn(Object.values(RosterEntryRole))
  role!: RosterEntryRole;

  @ReasonField('Substitution reason (stored as change_reason; audited)')
  reason!: string;
}

export class SeedEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  registrationId!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_TEAMS_MAX })
  @IsInt()
  @Min(1)
  @Max(MAX_TEAMS_MAX)
  seed!: number;
}

export class SeedsDto {
  @ApiProperty({ type: [SeedEntryDto], description: 'Every APPROVED registration, seeds 1..N' })
  @IsArray()
  @ArrayMaxSize(MAX_TEAMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => SeedEntryDto)
  seeds!: SeedEntryDto[];
}
