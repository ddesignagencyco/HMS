// apps/api/src/booking/booking.controller.ts
import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { bookingCancelSchema, bookingChecklistSchema, bookingCompleteSchema, bookingEvidenceSchema, bookingCreateSchema, bookingListQuerySchema, bookingNoShowSchema, bookingQuoteSchema, bookingRaiseRevisionSchema, bookingRescheduleSchema, bookingStartSchema, bookingWarrantyClaimSchema } from './booking.schemas.js';
import { BookingService } from './booking.service.js';
import { CompletionService } from './completion.service.js';
import { ExecutionService } from './execution.service.js';
import { PricingService } from './pricing.service.js';

@ApiTags('booking')
@ApiBearerAuth('access-token')
@Controller('bookings')
export class BookingController {
  constructor(
    @Inject(BookingService) private readonly bookings: BookingService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(ExecutionService) private readonly execution: ExecutionService,
    @Inject(CompletionService) private readonly completion: CompletionService
  ) {}

  @Post('quote')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({
    summary: 'Price a booking before committing to it',
    description:
      "Returns the itemised price a checkout would create: the service, any visit fee, the emergency surcharge (only for services that allow emergencies), the coupon discount, any cash fee you still owe from an earlier late cancellation, and the cancellation policy in plain words. Every amount is in integer paisa. Leave out providerId to price an auto-assigned job at the service's base price."
  })
  @ApiZodBody(bookingQuoteSchema, { default: { summary: 'Quote an emergency leak repair', value: { providerId: '00000000-0000-4000-8000-000000000000', serviceId: 1, isEmergency: true } } })
  async quote(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return (await this.pricing.price(principal.userId, parseWith(bookingQuoteSchema, body))).quote;
  }

  @Post()
  @HttpCode(201)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({
    summary: 'Check out a booking',
    description:
      "Books a service at a chosen time, with a specific provider (found through search) or, when providerId is left out, whichever ranked provider accepts first. A cash booking goes straight to REQUESTED. An online booking is held as PENDING_PAYMENT for a short window and returns a payment redirectUrl; it becomes REQUESTED only when the gateway's signed webhook confirms payment. The time must fall inside the provider's declared availability; the database itself refuses two overlapping bookings for one provider, so of two customers racing for a slot exactly one wins and the other gets 409 SLOT_TAKEN."
  })
  @ApiZodBody(bookingCreateSchema, {
    default: {
      summary: 'Book a plumber for a leak repair',
      value: { providerId: '00000000-0000-4000-8000-000000000000', serviceId: 1, addressId: '00000000-0000-4000-8000-000000000001', scheduledStart: '2026-10-01T10:00:00.000Z', scheduledEnd: '2026-10-01T11:00:00.000Z', problemText: 'Kitchen tap is leaking', paymentMode: 'ONLINE' }
    }
  })
  async create(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.create(principal.userId, parseWith(bookingCreateSchema, body));
  }

  @Post('checkout')
  @HttpCode(201)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({ summary: 'Check out a booking (alias of POST /bookings)', description: 'Identical to POST /bookings; the name the payment flow documentation uses for it.' })
  @ApiZodBody(bookingCreateSchema, { default: { summary: 'Cash booking', value: { providerId: '00000000-0000-4000-8000-000000000000', serviceId: 1, addressId: '00000000-0000-4000-8000-000000000001', scheduledStart: '2026-10-01T10:00:00.000Z', scheduledEnd: '2026-10-01T11:00:00.000Z', paymentMode: 'CASH' } } })
  async checkout(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.create(principal.userId, parseWith(bookingCreateSchema, body));
  }

  @Get(':id')
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({ summary: 'Read one booking', description: 'Returns full booking detail. Visible only to the booking\'s own customer or its assigned provider — anyone else gets a 404, same as everywhere else in this API that hides existence from non-owners.' })
  async getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.getOwned(id, principal.userId);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Accept a booking request',
    description:
      "The assigned provider accepts a REQUESTED booking, moving it to SCHEDULED and locking the slot. Only the provider this booking was requested for can accept it — anyone else gets a 404, and any other status gets 409 ILLEGAL_TRANSITION. Also issues the start code the customer will read out to the provider on arrival (FR-EX-02), sent by SMS."
  })
  async accept(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const booking = await this.bookings.apply(id, 'accept', principal.userId);
    await this.bookings.issueStartOtp(id);
    return booking;
  }

  @Post(':id/decline')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Decline a booking request', description: 'The assigned provider declines a REQUESTED booking, moving it to UNFULFILLED and freeing the slot for other providers.' })
  async decline(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.apply(id, 'decline', principal.userId);
  }

  @Post(':id/depart')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Mark yourself en route', description: 'The provider marks themselves en route for a SCHEDULED booking, moving it to EN_ROUTE. The customer is notified once notifications exist (FR-EX-01).' })
  async depart(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.apply(id, 'depart', principal.userId);
  }

  @Post(':id/start')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Start the job with the customer’s code',
    description:
      "The provider enters the 6-digit code the customer was sent when the booking was accepted, moving an EN_ROUTE booking to IN_PROGRESS (FR-EX-02). Optionally sends their location (lat, lng, accuracyM), recorded as the check-in and reported back as distanceM and withinGeofence — a shortfall is flagged, never blocking. A wrong code returns 422 OTP_INVALID with the remaining attempts; the fifth wrong attempt locks the code for 15 minutes and returns 423 OTP_LOCKED."
  })
  @ApiZodBody(bookingStartSchema, { default: { summary: 'Code the customer read out', value: { code: '123456' } } })
  async start(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.startWork(id, principal.userId, parseWith(bookingStartSchema, body));
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({
    summary: 'Reschedule a booking',
    description:
      "The customer moves a SCHEDULED booking to a new time, free of charge, once — and only if it's at least 4 hours before the current slot (FR-BK-05). The new time is re-checked against the provider's availability and leave exactly like a new booking; a second reschedule attempt or one made too late is rejected with 400."
  })
  @ApiZodBody(bookingRescheduleSchema, { default: { summary: 'Move to a later time the same week', value: { scheduledStart: '2026-10-02T10:00:00.000Z', scheduledEnd: '2026-10-02T11:00:00.000Z' } } })
  async reschedule(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.reschedule(id, principal.userId, parseWith(bookingRescheduleSchema, body));
  }

  @Post(':id/checklist/:itemId')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Mark a checklist item done',
    description:
      "Marks one step of the service's checklist as done for this IN_PROGRESS job. A step that requires a photo also needs the evidenceId of a CHECKLIST photo already uploaded for that step (422 otherwise). Every active step must be done before the job can be completed."
  })
  @ApiZodBody(bookingChecklistSchema, { default: { summary: 'Mark done', value: { done: true } } })
  async markChecklistItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseIntPipe) itemId: number, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { evidenceId } = parseWith(bookingChecklistSchema, body);
    return this.execution.markChecklistItemDone(id, principal.userId, itemId, evidenceId);
  }

  @Post(':id/evidence')
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({
    summary: 'Upload a photo',
    description:
      "Stores one photo (JPEG, PNG or WebP, base64, within the size limit) with a server timestamp. The customer attaches up to 5 CUSTOMER_PROBLEM photos before the visit; the provider records BEFORE, AFTER and per-step CHECKLIST photos while the job is in progress. clientUuid makes retries safe: uploading the same clientUuid twice stores it once and returns the original (200 with duplicate: true instead of 201). Evidence is insert-only — it can never be edited or deleted."
  })
  @ApiZodBody(bookingEvidenceSchema, { default: { summary: 'After photo', value: { clientUuid: '11111111-1111-4111-8111-111111111111', kind: 'AFTER', contentType: 'image/jpeg', contentBase64: '/9j/4AAQSkZJRg==', lat: 31.52, lng: 74.35 } } })
  async addEvidence(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Res({ passthrough: true }) response: Response, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const result = await this.execution.addEvidence(id, principal.userId, parseWith(bookingEvidenceSchema, body));
    response.status(result.duplicate ? 200 : 201);
    return { ...result.evidence, duplicate: result.duplicate };
  }

  @Get(':id/evidence')
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({ summary: 'List a booking’s photos', description: "Lists every photo recorded against the booking, oldest first, with when the server received each. Visible to the booking's customer and provider only." })
  async listEvidence(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.execution.listEvidence(id, principal.userId) };
  }

  @Post(':id/complete')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Mark the job complete',
    description:
      'Completes an IN_PROGRESS job: the start code must have been used, every checklist step done (photo steps with their photo), and a before and after photo on file (409 otherwise). finalAmountPaisa may lower the charge but never exceed the approved total (422). Generates the itemised invoice, then hands the job to verification — the returned booking is AWAITING_VERIFICATION, with a verification call queued.'
  })
  @ApiZodBody(bookingCompleteSchema, { default: { summary: 'Complete at the approved total', value: {} } })
  async complete(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.completion.complete(id, principal.userId, parseWith(bookingCompleteSchema, body ?? {}));
  }

  @Post(':id/cash-received')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Confirm the customer paid cash',
    description:
      "For a cash job whose verification has authorised collection: records that you were paid. Your commission is debited to your wallet (a negative wallet is commission debt; above the ceiling you stop receiving offers until you pay it down), the job becomes PAYMENT_RELEASED, and the customer is texted a receipt with a link to report a problem. 409 for an online job or before verification."
  })
  async cashReceived(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.confirmCashReceived(id, principal.userId);
  }

  @Post(':id/warranty-claim')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({
    summary: 'Claim under warranty',
    description:
      "Reopens a paid job as rework while the service's warranty lasts (409 after it, or if the service has none). The provider gets the rework window to come back, and you get a fresh start code to give them on the day. The repair is verified again; a second failure is escalated as a dispute."
  })
  @ApiZodBody(bookingWarrantyClaimSchema, { default: { summary: 'The leak is back', value: { reason: 'The pipe joint is leaking again' } } })
  async warrantyClaim(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.warrantyClaim(id, principal.userId, parseWith(bookingWarrantyClaimSchema, body).reason);
  }

  @Get(':id/invoice.pdf')
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Download the invoice', description: "The itemised invoice as a PDF, available once the job is completed, to the booking's customer and provider only (anyone else gets a 404)." })
  async invoicePdf(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) response: Response, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { filename, content } = await this.completion.invoicePdf(id, principal.userId);
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(content);
  }

  @Post(':id/revisions')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Raise a revised quote for extra work',
    description:
      "The provider proposes extra work found on site, moving an IN_PROGRESS booking to QUOTE_REVISION until the customer decides. Only one revision can be pending at a time (FR-EX-05) — the database enforces that, not just this endpoint."
  })
  @ApiZodBody(bookingRaiseRevisionSchema, { default: { summary: 'Found a burst pipe behind the wall', value: { deltaPaisa: 500000, reason: 'Additional pipe section needs replacing' } } })
  async raiseRevision(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.raiseQuoteRevision(id, principal.userId, parseWith(bookingRaiseRevisionSchema, body));
  }

  @Post(':id/revisions/approve')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({
    summary: 'Approve the pending revised quote',
    description: 'The customer approves the pending quote revision, adding its amount to the booking total and returning the booking to IN_PROGRESS so work can continue.'
  })
  async approveRevision(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.approveQuoteRevision(id, principal.userId);
  }

  @Post(':id/revisions/reject')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({
    summary: 'Reject the pending revised quote',
    description: 'The customer rejects the pending quote revision, at no charge, returning the booking to IN_PROGRESS without the extra work.'
  })
  async rejectRevision(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.rejectQuoteRevision(id, principal.userId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({
    summary: 'Cancel a scheduled booking',
    description:
      "Either party cancels a SCHEDULED booking, freeing the slot. Records which side cancelled (CANCELLED_CUSTOMER or CANCELLED_PROVIDER) so later reporting can tell them apart. The cancellation-fee rules (FR-BK-06) are not applied here yet — there is no ledger to post a fee to until M8 exists; this only records the cancellation and the optional reason."
  })
  @ApiZodBody(bookingCancelSchema, { default: { summary: 'Cancel with a reason', value: { reason: 'Found a closer provider' } } })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { reason } = parseWith(bookingCancelSchema, body);
    return this.bookings.apply(id, 'cancel', principal.userId, { reason });
  }

  @Post(':id/no-show')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({
    summary: 'Report a no-show',
    description: "Either party reports that the other did not show up for an EN_ROUTE booking, moving it to NO_SHOW and recording which side failed to show."
  })
  @ApiZodBody(bookingNoShowSchema, { default: { summary: 'Customer did not answer the door', value: { party: 'CUSTOMER' } } })
  async noShow(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { party } = parseWith(bookingNoShowSchema, body);
    return this.bookings.apply(id, 'noShow', principal.userId, { noShowParty: party });
  }

  @Get()
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({ summary: 'List my bookings', description: 'Returns every booking you are the customer or the provider on, most recent first. Optionally filter by status.' })
  @ApiQueryField('status', { enum: ['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'UNFULFILLED', 'CANCELLED_CUSTOMER', 'CANCELLED_PROVIDER', 'NO_SHOW'] })
  async listMine(@Query() query: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { status } = parseWith(bookingListQuerySchema, query);
    return { items: await this.bookings.listMine(principal.userId, status) };
  }
}
