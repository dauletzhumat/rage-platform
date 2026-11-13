import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ENV } from '../config/config.module.js';
import { type Env } from '../config/env.js';
import { APP_VERSION } from '../version.js';

export class SteamAuthFeatureDto {
  @ApiProperty({
    enum: ['unconfigured', 'configured'],
    description:
      '"configured" when realm, return URL, web URL and SESSION_SECRET are valid (Steam sign-in ' +
      'routes work); "unconfigured" otherwise (auth routes answer 503). Says nothing about ' +
      'whether a real Steam login has been verified manually.',
  })
  status!: 'unconfigured' | 'configured';
}

export class Cs2IntegrationFeatureDto {
  @ApiProperty({ enum: ['not_implemented'] })
  status!: 'not_implemented';
}

export class FeaturesDto {
  @ApiProperty({ type: SteamAuthFeatureDto })
  steamAuth!: SteamAuthFeatureDto;

  @ApiProperty({ type: Cs2IntegrationFeatureDto })
  cs2Integration!: Cs2IntegrationFeatureDto;
}

export class MetaDto {
  @ApiProperty({ enum: ['rage-api'] })
  name!: 'rage-api';

  @ApiProperty({ example: '0.0.0' })
  version!: string;

  @ApiProperty({ enum: ['v1'] })
  apiVersion!: 'v1';

  @ApiProperty({ enum: ['development', 'test', 'production'] })
  environment!: 'development' | 'test' | 'production';

  @ApiProperty({ type: FeaturesDto })
  features!: FeaturesDto;
}

@ApiTags('meta')
@Controller('meta')
export class MetaController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  @ApiOperation({ summary: 'Service metadata and honest feature availability flags' })
  @ApiOkResponse({ type: MetaDto })
  meta(): MetaDto {
    return {
      name: 'rage-api',
      version: this.env.APP_VERSION ?? APP_VERSION,
      apiVersion: 'v1',
      environment: this.env.NODE_ENV,
      features: {
        steamAuth: { status: this.env.steamAuth ? 'configured' : 'unconfigured' },
        cs2Integration: { status: 'not_implemented' },
      },
    };
  }
}
