import { ApiProperty } from '@nestjs/swagger';
import { RegistrationStatus, RosterEntryRole, RosterStatus } from '@rage/db';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/** `POST /tournaments/:id/registrations` and `PUT …/roster` body (docs/TOURNAMENTS.md §4). */
export class CreateRegistrationDto {
  @ApiProperty({ format: 'uuid', description: 'Team being registered (you must operate it)' })
  @IsUUID()
  teamId!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Exactly 5 distinct user ids (current active members of the team)',
  })
  @IsArray()
  @ArrayMaxSize(16)
  @IsUUID('all', { each: true })
  starters!: string[];

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: '0-2 distinct user ids, none of them a starter',
  })
  @IsArray()
  @ArrayMaxSize(16)
  @IsUUID('all', { each: true })
  substitutes!: string[];
}

export class TournamentRosterEntryDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() playerSlug!: string;
  @ApiProperty({
    example: '76561198000000000',
    description: 'SteamID64 snapshot (operator / admin views only)',
  })
  steamId64!: string;
  @ApiProperty({ description: 'Nickname snapshot taken when this roster version was created' })
  nickname!: string;
  @ApiProperty({ enum: RosterEntryRole, enumName: 'RosterEntryRole' }) role!: RosterEntryRole;
}

export class TournamentRosterDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ enum: RosterStatus, enumName: 'RosterStatus' }) status!: RosterStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lockedAt!: string | null;
  @ApiProperty({ type: [TournamentRosterEntryDto] }) entries!: TournamentRosterEntryDto[];
}

export class RegistrationTournamentRefDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
}

export class RegistrationTeamRefDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() tag!: string;
}

export class RegistrationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: RegistrationTournamentRefDto }) tournament!: RegistrationTournamentRefDto;
  @ApiProperty({ type: RegistrationTeamRefDto }) team!: RegistrationTeamRefDto;
  @ApiProperty({ enum: RegistrationStatus, enumName: 'RegistrationStatus' })
  status!: RegistrationStatus;
  @ApiProperty({ type: Number, nullable: true }) seed!: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Approval note or rejection reason (visible to the team operators)',
  })
  reviewReason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: TournamentRosterDto, description: 'Current (latest) roster version' })
  roster!: TournamentRosterDto;
}
