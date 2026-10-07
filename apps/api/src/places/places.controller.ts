import { Controller, Get, Inject, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/policy.js';
import { PlacesService } from './places.service.js';

@ApiTags('places')
@Controller('places')
export class PlacesController {
  constructor(@Inject(PlacesService) private readonly places: PlacesService) {}

  @Get('cities')
  @Public()
  @ApiOperation({
    summary: 'List the cities the platform operates in',
    description:
      'The platform currently launches in a single city, but the catalogue is city-aware from the outset. Each city carries the lat/lng of the centre of the areas it contains, usable directly as the lat/lng of GET /search/providers when no better point is known.'
  })
  async listCities() {
    return { items: await this.places.listActiveCities() };
  }

  @Get('cities/:cityId/areas')
  @Public()
  @ApiOperation({
    summary: 'List the areas within a city',
    description:
      'Use one of these area ids when creating a customer address. Each area carries the lat/lng of its centroid, so an area can be used directly as the lat/lng of GET /search/providers, and as the point for an address when the customer has not given an exact one. lat/lng are null only for an area whose centroid has not been surveyed yet.'
  })
  async listAreas(@Param('cityId', ParseIntPipe) cityId: number) {
    return { items: await this.places.listActiveAreas(cityId) };
  }
}
