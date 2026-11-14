import { Module } from '@nestjs/common';
import {
  AdminTeamApplicationsController,
  MyTeamApplicationsController,
  TeamApplicationsController,
} from './team-applications.controller.js';
import { TeamApplicationsService } from './team-applications.service.js';

@Module({
  controllers: [
    TeamApplicationsController,
    MyTeamApplicationsController,
    AdminTeamApplicationsController,
  ],
  providers: [TeamApplicationsService],
})
export class TeamApplicationsModule {}
