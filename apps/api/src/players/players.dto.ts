import { ApiProperty } from '@nestjs/swagger';
import { TeamRefDto } from '../common/http/dto.js';
import { PageMetaDto } from '../common/pagination/pagination.js';

export class PlayerSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() nickname!: string;
  @ApiProperty({ type: String, nullable: true, example: 'KZ' }) countryCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null;
  @ApiProperty({
    description: 'Verified SteamID64 (string; 17 digits)',
    example: '76561198000000000',
  })
  steamId64!: string;
  @ApiProperty({ description: 'True for clearly-labelled demo/seed data' }) isSample!: boolean;
}

export class PlayerDetailDto extends PlayerSummaryDto {
  @ApiProperty({ type: String, nullable: true }) biography!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: TeamRefDto, nullable: true }) currentTeam!: TeamRefDto | null;
}

export class PlayerPageDto extends PageMetaDto {
  @ApiProperty({ type: [PlayerSummaryDto] }) items!: PlayerSummaryDto[];
}
