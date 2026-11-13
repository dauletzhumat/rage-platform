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
import { PaginationQueryDto, SearchPaginationQueryDto } from '../common/pagination/pagination.js';
import { RosterHistoryPageDto, TeamDetailDto, TeamPageDto } from './teams.dto.js';
import { TeamsService } from './teams.service.js';

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @ApiOperation({ summary: 'List public (approved, active) teams' })
  @ApiOkResponse({ type: TeamPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  list(@Query() query: SearchPaginationQueryDto): Promise<TeamPageDto> {
    return this.teams.list(query);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Public team profile with current roster' })
  @ApiOkResponse({ type: TeamDetailDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(@Param('slug', new SlugParamPipe('Team')) slug: string): Promise<TeamDetailDto> {
    return this.teams.getBySlug(slug);
  }

  @Get(':slug/roster-history')
  @ApiOperation({
    summary: 'Public roster history (all membership rows, newest first)',
    description:
      'Ordered by joinedAt DESC, id DESC. `leftReason` is one of left / removed / role_change / ' +
      'captain_transfer / admin — never free text.',
  })
  @ApiOkResponse({ type: RosterHistoryPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  rosterHistory(
    @Param('slug', new SlugParamPipe('Team')) slug: string,
    @Query() query: PaginationQueryDto,
  ): Promise<RosterHistoryPageDto> {
    return this.teams.rosterHistory(slug, query);
  }
}
