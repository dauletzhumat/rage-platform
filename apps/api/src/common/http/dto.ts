import { ApiProperty } from '@nestjs/swagger';

/** Compact team reference embedded in other resources. */
export class TeamRefDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() tag!: string;
}

export class TournamentRefDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
