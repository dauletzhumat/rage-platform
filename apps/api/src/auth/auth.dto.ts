import { ApiProperty } from '@nestjs/swagger';

export class CsrfTokenDto {
  @ApiProperty({ description: 'Send as `x-csrf-token` on unsafe requests' })
  csrfToken!: string;
}
