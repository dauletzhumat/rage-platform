import { Module } from '@nestjs/common';
import { TeamsModule } from '../teams/teams.module.js';
import { TeamManagementController } from './team-management.controller.js';
import { TeamManagementService } from './team-management.service.js';

@Module({
  imports: [TeamsModule],
  controllers: [TeamManagementController],
  providers: [TeamManagementService],
})
export class TeamManagementModule {}
