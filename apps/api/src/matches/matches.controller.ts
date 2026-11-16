import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { auditContextOf } from '../audit/audit.service.js';
import { Authenticated } from '../auth/auth.decorators.js';
import { CurrentUser } from '../auth/guards.js';
import type { AuthContext } from '../auth/session.service.js';
import { ApiErrorDto } from '../common/errors/api-error.js';
import { uuidParam } from '../common/http/params.js';
import type { RequestWithIds } from '../common/http/request-id.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { PaginationQueryDto } from '../common/pagination/pagination.js';
import { MatchResultsService } from './match-results.service.js';
import {
  AdminMatchesQueryDto,
  ForfeitDto,
  MatchDetailDto,
  MatchPageDto,
  ResultOverrideDto,
  SubmitVetoDto,
  VetoStateDto,
} from './matches.dto.js';
import { MatchesService } from './matches.service.js';
import { VetoService } from './veto.service.js';

@ApiTags('matches')
@Controller('matches')
export class MatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly veto: VetoService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List public matches (series)' })
  @ApiOkResponse({ type: MatchPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  list(@Query() query: PaginationQueryDto): Promise<MatchPageDto> {
    return this.matches.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Public match (series) detail with result source and per-map scores' })
  @ApiOkResponse({ type: MatchDetailDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(@Param('id', uuidParam('id')) id: string): Promise<MatchDetailDto> {
    return this.matches.getById(id);
  }

  @Get(':id/veto')
  @ApiOperation({ summary: 'Public map veto state (pool, actions, whose turn, remaining maps)' })
  @ApiOkResponse({ type: VetoStateDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  getVeto(@Param('id', uuidParam('id')) id: string): Promise<VetoStateDto> {
    return this.veto.getState(id);
  }

  @Post(':id/veto')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Ban / pick a map (operator of the team whose turn it is; audited)',
    description:
      'Fixed sequences per BO1/BO3/BO5, team A starts (docs/TOURNAMENTS.md §8). When only the ' +
      'decider remains, the server records DECIDER and creates the match maps.',
  })
  @ApiOkResponse({ type: VetoStateDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'FORBIDDEN_ROLE | CSRF_FAILED' })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      'VETO_NOT_YOUR_TURN | VETO_INVALID_MAP | VETO_COMPLETE | MATCH_NOT_READY | SAMPLE_RESOURCE',
  })
  submitVeto(
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: SubmitVetoDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<VetoStateDto> {
    return this.veto.submit(auth.userId, id, dto, auditContextOf(req));
  }
}

@ApiTags('admin')
@Controller('admin/matches')
export class AdminMatchesController {
  constructor(private readonly results: MatchResultsService) {}

  @Get()
  @Authenticated()
  @ApiOperation({
    summary:
      'Matches for result administration (match / tournament admins; scoped grants see theirs)',
  })
  @ApiOkResponse({ type: MatchPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'FORBIDDEN_ROLE' })
  list(
    @Query() query: AdminMatchesQueryDto,
    @CurrentUser() auth: AuthContext,
  ): Promise<MatchPageDto> {
    return this.results.listForAdmin(auth.userId, query);
  }

  @Post(':id/result-override')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Enter a series result as an admin (match admin; audited; NOT server-verified)',
    description:
      'Scores are maps won (BO1 1-0; BO3 2-0/2-1; BO5 3-0/3-1/3-2). Sets COMPLETED with ' +
      'result_source ADMIN_OVERRIDE and advances the winner in the same transaction.',
  })
  @ApiOkResponse({ type: MatchDetailDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'VALIDATION_FAILED | SCORE_INVALID' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'FORBIDDEN_ROLE | CSRF_FAILED' })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'MATCH_NOT_READY | MATCH_ALREADY_COMPLETED | SAMPLE_RESOURCE',
  })
  override(
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: ResultOverrideDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<MatchDetailDto> {
    return this.results.override(auth.userId, id, dto, auditContextOf(req));
  }

  @Post(':id/forfeit')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ unsafe: true })
  @Idempotent()
  @ApiOperation({
    summary: 'Record a forfeit (match admin; audited): the other team wins, scores stay null',
  })
  @ApiOkResponse({ type: MatchDetailDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'FORBIDDEN_ROLE | CSRF_FAILED' })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'MATCH_NOT_READY | MATCH_ALREADY_COMPLETED | SAMPLE_RESOURCE',
  })
  forfeit(
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: ForfeitDto,
    @CurrentUser() auth: AuthContext,
    @Req() req: RequestWithIds,
  ): Promise<MatchDetailDto> {
    return this.results.forfeit(auth.userId, id, dto, auditContextOf(req));
  }
}
