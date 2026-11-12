import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/errors/api-error.js';
import { uuidParam } from '../common/http/params.js';
import { PaginationQueryDto } from '../common/pagination/pagination.js';
import { MatchDetailDto, MatchPageDto } from './matches.dto.js';
import { MatchesService } from './matches.service.js';

@ApiTags('matches')
@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  @ApiOperation({ summary: 'List public matches (series)' })
  @ApiOkResponse({ type: MatchPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  list(@Query() query: PaginationQueryDto): Promise<MatchPageDto> {
    return this.matches.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Public match (series) detail with per-map scores' })
  @ApiOkResponse({ type: MatchDetailDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(@Param('id', uuidParam('id')) id: string): Promise<MatchDetailDto> {
    return this.matches.getById(id);
  }
}
