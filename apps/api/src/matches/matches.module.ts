import { Module } from '@nestjs/common';
import { MatchResultsService } from './match-results.service.js';
import { AdminMatchesController, MatchesController } from './matches.controller.js';
import { MatchesService } from './matches.service.js';
import { VetoService } from './veto.service.js';

@Module({
  controllers: [MatchesController, AdminMatchesController],
  providers: [MatchesService, VetoService, MatchResultsService],
})
export class MatchesModule {}
