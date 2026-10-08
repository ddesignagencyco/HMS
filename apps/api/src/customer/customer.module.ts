import { Module } from '@nestjs/common';
import { AddressesController } from './addresses.controller.js';
import { AddressesService } from './addresses.service.js';
import { FavouritesService } from './favourites.service.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';

@Module({
  controllers: [AddressesController, MeController],
  providers: [AddressesService, MeService, FavouritesService]
})
export class CustomerModule {}
