import { Module } from '@nestjs/common';
import { InvitationsController, MyInvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';

@Module({
  controllers: [MyInvitationsController, InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
