import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsISO31661Alpha2,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { BIOGRAPHY_PATTERN } from '../me/me.dto.js';
import {
  normalizeText,
  REASON_MAX,
  REASON_MIN,
  TEAM_DESCRIPTION_MAX,
  TEAM_NAME_MAX,
  TEAM_NAME_MIN,
  TEAM_NAME_PATTERN,
  TEAM_TAG_MAX,
  TEAM_TAG_MIN,
  TEAM_TAG_PATTERN,
} from './team-policy.js';

const emptyToNull = ({ value }: { value: unknown }) => {
  const v = normalizeText(value);
  return v === '' ? null : v;
};

/** Required free-text reason (reject / remove / admin create): NFC, trimmed, 3–500, no controls. */
export function ReasonField(description: string) {
  return applyDecorators(
    ApiProperty({ minLength: REASON_MIN, maxLength: REASON_MAX, description }),
    Transform(({ value }: { value: unknown }) => normalizeText(value)),
    IsString(),
    Length(REASON_MIN, REASON_MAX),
    Matches(BIOGRAPHY_PATTERN, {
      message: 'reason must not contain control or text-direction override characters',
    }),
  );
}

/** Optional reason / note: absent, null or empty ⇒ null; otherwise same rules as ReasonField. */
export function OptionalReasonField(description: string) {
  return applyDecorators(
    ApiPropertyOptional({
      type: String,
      nullable: true,
      minLength: REASON_MIN,
      maxLength: REASON_MAX,
      description,
    }),
    Transform(emptyToNull),
    ValidateIf((_o, v) => v !== null && v !== undefined),
    IsString(),
    Length(REASON_MIN, REASON_MAX),
    Matches(BIOGRAPHY_PATTERN, {
      message: 'text must not contain control or text-direction override characters',
    }),
  );
}

/** Name / tag / country / description shared by applications and the admin create (TEAMS.md §2). */
export class TeamIdentityInputDto {
  @ApiProperty({
    minLength: TEAM_NAME_MIN,
    maxLength: TEAM_NAME_MAX,
    example: 'Steppe Wolves',
    description: 'NFC, trimmed; letters, digits, space, ".", "_", "-"; starts with letter/digit',
  })
  @Transform(({ value }: { value: unknown }) => normalizeText(value))
  @IsString()
  @Length(TEAM_NAME_MIN, TEAM_NAME_MAX)
  @Matches(TEAM_NAME_PATTERN, {
    message:
      'name must start with a letter or digit and contain only letters, digits, spaces, ".", "_" and "-"',
  })
  name!: string;

  @ApiProperty({ minLength: TEAM_TAG_MIN, maxLength: TEAM_TAG_MAX, example: 'SWLV' })
  @Transform(({ value }: { value: unknown }) => normalizeText(value))
  @IsString()
  @Length(TEAM_TAG_MIN, TEAM_TAG_MAX)
  @Matches(TEAM_TAG_PATTERN, { message: 'tag may contain only letters A-Z and digits' })
  tag!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'KZ',
    description: 'ISO 3166-1 alpha-2, uppercase',
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be two uppercase letters' })
  @IsISO31661Alpha2()
  countryCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: TEAM_DESCRIPTION_MAX })
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(TEAM_DESCRIPTION_MAX)
  @Matches(BIOGRAPHY_PATTERN, {
    message: 'description must not contain control or text-direction override characters',
  })
  description?: string | null;
}
