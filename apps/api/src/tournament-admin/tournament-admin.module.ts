import { Module } from '@nestjs/common';
import { BracketAdminService } from './bracket-admin.service.js';
import { RegistrationReviewService } from './registration-review.service.js';
import { AdminTournamentsController } from './tournament-admin.controller.js';
import { TournamentAdminService } from './tournament-admin.service.js';

@Module({
  controllers: [AdminTournamentsController],
  providers: [TournamentAdminService, RegistrationReviewService, BracketAdminService],
})
export class TournamentAdminModule {}
