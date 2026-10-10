import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { subscriptionCancelSchema } from './plans.schemas.js';
import { PlansService } from './plans.service.js';

@ApiTags('plans')
@ApiBearerAuth('access-token')
@Controller()
export class SubscriptionsController {
  constructor(@Inject(PlansService) private readonly plans: PlansService) {}

  @Get('me/subscriptions')
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({
    summary: 'List my plan subscriptions',
    description: 'Returns all maintenance plan subscriptions for the current customer, including visit status counts.'
  })
  async listMine(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.plans.listCustomerSubscriptions(principal.userId) };
  }

  @Get('subscriptions/:id')
  @Authenticated()
  @ApiOperation({
    summary: 'Get details of a subscription',
    description: 'Returns details of a subscription, including its full schedule of visits and linked bookings.'
  })
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.plans.getSubscription(principal, id);
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({
    summary: 'Cancel a maintenance plan subscription',
    description: 'Cancels the subscription and issues a pro-rata refund for unused (pending) visits, correct to the exact paisa.'
  })
  @ApiZodBody(subscriptionCancelSchema, {
    default: {
      summary: 'Cancellation reason',
      value: { reason: 'Moving to a new home' }
    }
  })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ) {
    const input = parseWith(subscriptionCancelSchema, body);
    return this.plans.cancelSubscription(principal, id, input.reason);
  }
}
