import { Module } from '@nestjs/common';
import { PlayersController } from './players.controller.js';
import { PlayersService } from './players.service.js';

@Module({ controllers: [PlayersController], providers: [PlayersService] })
export class PlayersModule {}
