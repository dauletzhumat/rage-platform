import { Module } from '@nestjs/common';
import { AdminAuditController, AdminUsersController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({ controllers: [AdminUsersController, AdminAuditController], providers: [AdminService] })
export class AdminModule {}
