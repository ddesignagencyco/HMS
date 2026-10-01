// apps/api/src/complaints/complaints.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Public, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { complaintAssignSchema, complaintCreateSchema, complaintEvidenceSchema, complaintListQuery, complaintReplySchema, complaintTransitionSchema, receiptComplaintSchema } from './complaints.schemas.js';
import { ComplaintsService } from './complaints.service.js';

const PARTY = { roles: ['CUSTOMER', 'PROVIDER'] } as const;
const ADMIN = { roles: ['ADMIN'], totpRequired: true } as const;

const roleOf = (principal: AuthenticatedPrincipal): 'CUSTOMER' | 'PROVIDER' => (principal.roles.includes('PROVIDER') ? 'PROVIDER' : 'CUSTOMER');

@ApiTags('complaints')
@ApiBearerAuth('access-token')
@Controller()
export class ComplaintsController {
  constructor(@Inject(ComplaintsService) private readonly complaints: ComplaintsService) {}

  @Post('complaints')
  @HttpCode(201)
  @PolicyDecorator(PARTY)
  @ApiOperation({
    summary: 'Raise a complaint',
    description:
      "A customer complains about their provider (misbehaviour, quality, overcharge, no-show, safety, cash discrepancy, other) and a provider about their customer (non-payment, unsafe premises, abuse, cash discrepancy, other), always about one of their own bookings, with up to five photos. Safety and unsafe-premises complaints are urgent: one-hour SLA and the admins are alerted at once. A completed job can be complained about for `verification.post_release_complaint_days` after its release. The other party can see it and reply."
  })
  @ApiZodBody(complaintCreateSchema, { default: { summary: 'The work was poor', value: { bookingId: '00000000-0000-4000-8000-000000000000', category: 'QUALITY', description: 'The tap started leaking again the same evening.' } } })
  async create(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.complaints.create({ userId: principal.userId, role: roleOf(principal) }, parseWith(complaintCreateSchema, body));
  }

  @Post('complaints/from-receipt')
  @HttpCode(201)
  @Public()
  @ApiOperation({
    summary: 'Report a problem from a receipt link',
    description: "For a customer who follows the 'report a problem' link on their cash receipt without signing in. The token in the link proves which booking it is; same categories, photos and window as a signed-in complaint. 404 for a token that was not issued by us."
  })
  @ApiZodBody(receiptComplaintSchema, { default: { summary: 'Overcharged', value: { token: 'the-token-from-the-receipt-link', category: 'OVERCHARGE', description: 'I was asked for extra money on top of the invoice.' } } })
  async fromReceipt(@Body() body: unknown) {
    const { token, category, description, photos } = parseWith(receiptComplaintSchema, body);
    return this.complaints.createFromReceipt(token, { category, description, photos });
  }

  @Get('complaints')
  @PolicyDecorator(PARTY)
  @ApiOperation({ summary: 'List my complaints', description: 'Complaints you raised and complaints raised about you, newest first, with their state and SLA.' })
  async mine(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.complaints.listMine(principal.userId) };
  }

  @Get('complaints/:id')
  @PolicyDecorator(PARTY)
  @ApiOperation({ summary: 'Read a complaint and its timeline', description: 'Visible to the person who raised it and the person it is about — that is what gives the respondent their right of reply. Anyone else gets a 404.' })
  async one(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.complaints.viewFor(principal.userId, id);
  }

  @Post('complaints/:id/reply')
  @HttpCode(200)
  @PolicyDecorator(PARTY)
  @ApiOperation({ summary: 'Reply on a complaint', description: 'The respondent’s reply, or the complainant’s further comment, added to the timeline. If the admin was waiting for the respondent, their reply puts the complaint back under review.' })
  @ApiZodBody(complaintReplySchema, { default: { summary: 'My side', value: { body: 'I fitted the part as agreed and the customer signed off.' } } })
  async reply(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.complaints.reply(principal.userId, id, parseWith(complaintReplySchema, body).body);
  }

  @Post('complaints/:id/evidence')
  @HttpCode(201)
  @PolicyDecorator(PARTY)
  @ApiOperation({ summary: 'Add a photo to a complaint', description: 'Adds one photo (JPEG, PNG or WebP, base64) to an open complaint you are a party to; five in all.' })
  @ApiZodBody(complaintEvidenceSchema, { default: { summary: 'A photo', value: { contentType: 'image/jpeg', contentBase64: '/9j/4AAQSkZJRg==' } } })
  async evidence(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.complaints.addEvidence(principal.userId, id, parseWith(complaintEvidenceSchema, body));
  }

  @Get('admin/complaints')
  @PolicyDecorator(ADMIN)
  @ApiOperation({
    summary: 'The complaint queue',
    description: 'Admin only. Open complaints first, safety at the very top, then by how soon the SLA runs out (`slaRemainingMinutes`, negative and `slaBreached` once missed). Filter by status, severity, assignee, or `open=true|false`.'
  })
  @ApiQueryField('status', { description: 'OPEN, UNDER_REVIEW, AWAITING_RESPONSE, RESOLVED or REJECTED' })
  @ApiQueryField('severity', { description: 'SAFETY, HIGH or NORMAL' })
  @ApiQueryField('assignedTo', { description: 'Only complaints assigned to this staff user' })
  @ApiQueryField('open', { description: 'true for open complaints only, false for closed ones' })
  async queue(@Query() query: unknown) {
    return { items: await this.complaints.queue(parseWith(complaintListQuery, query)) };
  }

  @Get('admin/complaints/:id')
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'Open a complaint', description: 'Admin only. The complaint with its timeline, the booking, any dispute and any penalty tied to it.' })
  async adminOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.complaints.adminView(id);
  }

  @Post('admin/complaints/:id/assign')
  @HttpCode(200)
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'Assign a complaint', description: 'Admin only. Takes the complaint yourself, or gives it to another admin or agent with `assigneeId`. Recorded on the timeline and in the audit log.' })
  @ApiZodBody(complaintAssignSchema, { default: { summary: 'Take it myself', value: {} } })
  async assign(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.complaints.assign(principal.userId, id, parseWith(complaintAssignSchema, body ?? {}).assigneeId);
  }

  @Post('admin/complaints/:id/transition')
  @HttpCode(200)
  @PolicyDecorator(ADMIN)
  @ApiOperation({
    summary: 'Move a complaint along, or decide it',
    description:
      "Admin only. OPEN → UNDER_REVIEW → AWAITING_RESPONSE ⇄ UNDER_REVIEW → RESOLVED or REJECTED; any other move is 409. Closing needs a note; RESOLVED needs a `resolution`: NO_ACTION, WARNING, PARTIAL_REFUND (`refundPaisa`) or FULL_REFUND (online jobs; the platform bears it, since the money has already gone to the provider), PROVIDER_PENALTY (`breachCode`; only proposed — the provider still has their right of reply), TEMPORARY_SUSPENSION (`suspensionDays`) or PERMANENT_BLOCK. The consequence is carried out in the same transaction as the decision."
  })
  @ApiZodBody(complaintTransitionSchema, { default: { summary: 'Resolve with a partial refund', value: { to: 'RESOLVED', note: 'Half the work was not done', resolution: 'PARTIAL_REFUND', refundPaisa: 50000 } } })
  async transition(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.complaints.transition(principal.userId, id, parseWith(complaintTransitionSchema, body));
  }

  @Post('admin/complaints/:id/open-dispute')
  @HttpCode(200)
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'Freeze the job’s money as a dispute', description: 'Admin only. For a complaint about a job still awaiting verification: moves the booking to DISPUTED so its money cannot be released while a ruling is pending, and opens the dispute.' })
  async openDispute(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.complaints.openDispute(principal.userId, id);
  }
}
