import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, Public, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { planSubscribeSchema } from './plans.schemas.js';
import { PlansService } from './plans.service.js';

@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(@Inject(PlansService) private readonly plans: PlansService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Browse available maintenance plans',
    description: 'Lists all active maintenance plans, included services, visit allocations, and pricing.'
  })
  async list() {
    return { items: await this.plans.listPublicPlans() };
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Get details of a maintenance plan',
    description: 'Returns the full definition of a maintenance plan, including its service list and duration.'
  })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.getPublicPlan(id);
  }

  @Post(':id/subscribe')
  @HttpCode(201)
  @ApiBearerAuth('access-token')
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({
    summary: 'Subscribe to a maintenance plan',
    description: 'Subscribes the customer to a maintenance plan, schedules visits with exact paisa integrity, and starts the payment checkout.'
  })
  @ApiZodBody(planSubscribeSchema, {
    default: {
      summary: 'Subscribe to plan',
      value: { addressId: '11111111-1111-1111-1111-111111111111' }
    }
  })
  async subscribe(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ) {
    const input = parseWith(planSubscribeSchema, body);
    return this.plans.subscribe(principal.userId, id, input);
  }
}
