import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';
import { PageMetaDto, PaginationQueryDto } from '../common/pagination/pagination.js';
import { ReasonField } from '../team-domain/team-input.dto.js';

export class CreateSteamBanDto {
  @ApiProperty({ example: '76561198000000000', description: 'SteamID64 (17 digits)' })
  @IsString()
  @Matches(/^\d{17}$/, { message: 'steamId64 must be 17 digits' })
  steamId64!: string;

  @ReasonField('Ban reason (audited; admin-only)')
  reason!: string;
}

export class LiftSteamBanDto {
  @ReasonField('Why the ban is lifted (audited)')
  reason!: string;
}

export class SteamBansQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'true = only active bans, false = only lifted bans' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active?: boolean;
}

export class BanActorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() nickname!: string;
}

export class BannedSteamIdDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '76561198000000000' }) steamId64!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: BanActorDto, nullable: true }) createdBy!: BanActorDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) liftedAt!: string | null;
  @ApiProperty({ type: BanActorDto, nullable: true }) liftedBy!: BanActorDto | null;
  @ApiProperty({ type: String, nullable: true }) liftReason!: string | null;
  @ApiProperty({ description: 'True while not lifted' }) active!: boolean;
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Registered user with this SteamID64, if any',
  })
  userId!: string | null;
}

export class BannedSteamIdPageDto extends PageMetaDto {
  @ApiProperty({ type: [BannedSteamIdDto] }) items!: BannedSteamIdDto[];
}
