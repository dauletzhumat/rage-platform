import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorDetailDto {
  @ApiProperty({ description: 'Field path (dot notation) or "(root)"', example: 'pageSize' })
  field!: string;

  @ApiProperty({ example: 'pageSize must not be greater than 100' })
  message!: string;
}

/** Normalized error envelope returned by every failing endpoint. */
export class ApiErrorDto {
  @ApiProperty({ example: 404 })
  statusCode!: number;

  @ApiProperty({ example: 'Not Found', description: 'HTTP reason phrase' })
  error!: string;

  @ApiProperty({ example: 'Team not found' })
  message!: string;

  @ApiProperty({ example: '0b6b6c4e-7c0e-4d1b-9a43-0d8b0b0e8a11' })
  requestId!: string;

  @ApiPropertyOptional({ type: [ApiErrorDetailDto] })
  details?: ApiErrorDetailDto[];
}
