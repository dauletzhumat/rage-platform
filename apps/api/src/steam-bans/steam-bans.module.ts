import { Module } from '@nestjs/common';
import { AdminSteamBansController } from './steam-bans.controller.js';
import { SteamBansService } from './steam-bans.service.js';

@Module({ controllers: [AdminSteamBansController], providers: [SteamBansService] })
export class SteamBansModule {}
