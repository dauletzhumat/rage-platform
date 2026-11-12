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
import {
  TournamentDetailDto,
  TournamentListQueryDto,
  TournamentPageDto,
} from './tournaments.dto.js';
import { TournamentsService } from './tournaments.service.js';

@ApiTags('tournaments')
@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Get()
  @ApiOperation({ summary: 'List published tournaments (drafts are never listed)' })
  @ApiOkResponse({ type: TournamentPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  list(@Query() query: TournamentListQueryDto): Promise<TournamentPageDto> {
    return this.tournaments.list(query);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Public tournament detail' })
  @ApiOkResponse({ type: TournamentDetailDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(@Param('slug', new SlugParamPipe('Tournament')) slug: string): Promise<TournamentDetailDto> {
    return this.tournaments.getBySlug(slug);
  }
}
