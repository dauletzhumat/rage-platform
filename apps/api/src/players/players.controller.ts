import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/errors/api-error.js';
import { SlugParamPipe } from '../common/http/params.js';
import { SearchPaginationQueryDto } from '../common/pagination/pagination.js';
import { PlayerDetailDto, PlayerPageDto } from './players.dto.js';
import { PlayersService } from './players.service.js';

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Get()
  @ApiOperation({ summary: 'List public player profiles' })
  @ApiOkResponse({ type: PlayerPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  list(@Query() query: SearchPaginationQueryDto): Promise<PlayerPageDto> {
    return this.players.list(query);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Public player profile' })
  @ApiOkResponse({ type: PlayerDetailDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(@Param('slug', new SlugParamPipe('Player')) slug: string): Promise<PlayerDetailDto> {
    return this.players.getBySlug(slug);
  }
}
