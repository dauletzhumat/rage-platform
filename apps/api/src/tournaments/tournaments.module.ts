import { Module } from '@nestjs/common';
import { TournamentsController } from './tournaments.controller.js';
import { TournamentsService } from './tournaments.service.js';

@Module({ controllers: [TournamentsController], providers: [TournamentsService] })
export class TournamentsModule {}
