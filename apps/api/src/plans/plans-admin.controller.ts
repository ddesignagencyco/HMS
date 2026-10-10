import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { planCreateSchema, planUpdateSchema } from './plans.schemas.js';
import { PlansService } from './plans.service.js';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/plans')
export class PlansAdminController {
  constructor(@Inject(PlansService) private readonly plans: PlansService) {}

  @Get()
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: 'List all maintenance plans (admin)',
    description: 'Returns all plans including inactive ones, with active subscriber counts.'
  })
  async list() {
    return { items: await this.plans.adminListPlans() };
  }

  @Post()
  @HttpCode(201)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: 'Create a maintenance plan',
    description: 'Defines a new maintenance plan with included services, visit allocations, intervals, and price.'
  })
  @ApiZodBody(planCreateSchema, {
    default: {
      summary: 'AC & Electrical Maintenance Annual Plan',
      value: {
        nameEn: 'Annual AC & Electrical Care',
        nameUr: 'سالانہ اے سی اور الیکٹریکل دیکھ بھال',
        description: 'Comprehensive annual care package covering AC and electrical checks.',
        pricePaisa: 5000000,
        durationMonths: 12,
        services: [
          { serviceId: 1, visitsIncluded: 2, intervalDays: 180 },
          { serviceId: 2, visitsIncluded: 4, intervalDays: 90 }
        ]
      }
    }
  })
  async create(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const input = parseWith(planCreateSchema, body);
    return this.plans.adminCreatePlan(principal.userId, input);
  }

  @Get(':id')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: 'Get plan details (admin)',
    description: 'Returns complete plan definition.'
  })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.getPublicPlan(id);
  }

  @Patch(':id')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: 'Update a maintenance plan',
    description: 'Modifies plan metadata, pricing, duration, or active status.'
  })
  @ApiZodBody(planUpdateSchema, {
    default: {
      summary: 'Update plan price',
      value: { pricePaisa: 5500000 }
    }
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ) {
    const input = parseWith(planUpdateSchema, body);
    return this.plans.adminUpdatePlan(principal.userId, id, input);
  }

  @Delete(':id')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: 'Deactivate a maintenance plan',
    description: 'Deactivates a plan so it cannot receive new subscriptions, while leaving existing subscriptions untouched.'
  })
  async deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.plans.adminDeactivatePlan(principal.userId, id);
  }
}
