import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BOOKING_STATUS_VALUES } from '@smart-home/domain';
import { ApiPageQuery } from '../common/paging.js';
import { PolicyDecorator } from '../common/policy.js';
import { ApiQueryField } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { AdminService } from './admin.service.js';
import { listAdminBookingsQuerySchema } from './admin.schemas.js';

/** BE-009 (§3.4): the bookings behind the ops-board counts. */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: 'List every booking on the platform',
    description:
      'Admin only. Newest first, paged (`{ items, pagination }`). Rows are the same as `GET /bookings` (readable service, address and area names) plus `customerName`, `providerName` and `cityId`. Filter by status, creation date range, city (of the service address), provider, customer, emergency flag, or a booking-code search.'
  })
  @ApiQueryField('status', { enum: BOOKING_STATUS_VALUES })
  @ApiQueryField('from', { description: 'ISO timestamp: bookings created at or after this.' })
  @ApiQueryField('to', { description: 'ISO timestamp: bookings created at or before this.' })
  @ApiQueryField('cityId', { type: 'number', description: 'City of the service address.' })
  @ApiQueryField('providerId', { description: 'Only this provider’s bookings.' })
  @ApiQueryField('customerId', { description: 'Only this customer’s bookings.' })
  @ApiQueryField('isEmergency', { type: 'boolean', description: 'true or false.' })
  @ApiQueryField('q', { description: 'Booking code, or part of it.' })
  @ApiPageQuery()
  async list(@Query() query: unknown) {
    return this.admin.listBookings(parseWith(listAdminBookingsQuerySchema, query));
  }
}
