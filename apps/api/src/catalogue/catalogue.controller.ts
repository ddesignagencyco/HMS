import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/policy.js';
import { CatalogueService } from './catalogue.service.js';

@ApiTags('catalogue')
@Controller('catalogue')
export class CatalogueController {
  constructor(@Inject(CatalogueService) private readonly catalogue: CatalogueService) {}

  @Get('categories')
  @Public()
  @ApiOperation({ summary: 'Browse the service categories', description: 'Returns every active category (plumbing, electrical, and so on), sorted for display. Inactive categories are hidden from this public listing.' })
  async listCategories() {
    return { items: await this.catalogue.listActiveCategories() };
  }

  @Get('categories/:slug/services')
  @Public()
  @ApiOperation({ summary: 'Browse the services in a category', description: 'Returns every active service offered in the given category, such as "leak-repair" under "plumbing".' })
  async listServicesInCategory(@Param('slug') slug: string) {
    return { items: await this.catalogue.listActiveServicesInCategory(slug) };
  }

  @Get('services/:slug/issue-options')
  @Public()
  @ApiOperation({
    summary: 'The common faults a customer can pick from when booking this service',
    description:
      'The dropdown the booking screen offers, in display order and in both languages. Its purpose is to help a customer who cannot describe the problem in technical terms — "the AC runs but does not cool" rather than a paragraph of their own. It is not a constraint: a booking may choose an option, write free text instead, or do both.'
  })
  async issueOptions(@Param('slug') slug: string) {
    const service = await this.catalogue.getServiceDetailBySlug(slug);
    return { items: service.issueOptions };
  }

  @Get('services/:slug')
  @Public()
  @ApiOperation({ summary: 'Get one service, including its checklist', description: 'Returns full pricing and duration details for one bookable service, plus the ordered checklist the provider must complete on the job.' })
  async serviceDetail(@Param('slug') slug: string) {
    return this.catalogue.getServiceDetailBySlug(slug);
  }
}
