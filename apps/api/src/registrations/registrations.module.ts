import { Module } from '@nestjs/common';
import { MyRegistrationsController, RegistrationsController } from './registrations.controller.js';
import { RegistrationsService } from './registrations.service.js';

@Module({
  controllers: [RegistrationsController, MyRegistrationsController],
  providers: [RegistrationsService],
})
export class RegistrationsModule {}
