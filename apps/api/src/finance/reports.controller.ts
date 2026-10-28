// apps/api/src/finance/reports.controller.ts
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { parseWith } from '../common/validation.js';
import { ReportsService } from './reports.service.js';

const FINANCE = { roles: ['FINANCE', 'ADMIN'], totpRequired: true } as const;

const requestSchema = z
  .object({
    type: z.enum(['MONTHLY', 'REVENUE', 'PROVIDER_PERFORMANCE', 'VERIFICATION']),
    /** Inclusive. */
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'periodStart must be YYYY-MM-DD'),
    /** Exclusive, so adjacent periods tile without a gap or an overlap. */
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'periodEnd must be YYYY-MM-DD'),
    format: z.enum(['PDF', 'XLSX'])
  })
  .strict()
  .refine(input => input.periodEnd > input.periodStart, { message: 'periodEnd must be after periodStart', path: ['periodEnd'] });

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@Controller('finance/reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Post()
  @PolicyDecorator(FINANCE)
  @ApiOperation({
    summary: 'Ask for a report',
    description:
      'Queues a report and returns immediately — these are too slow to build inside a request. Poll `GET /finance/reports/{id}`, or wait for the `report.ready` notification, and download when it is `DONE`. Asking again for a period that is already queued or running returns that run rather than starting a second copy of the same numbers. **Revenue is taken from the ledger, not from the quoted booking totals**, so it agrees with the finance console to the paisa — that is the whole point of a revenue report, and it is why it is never computed a second way.'
  })
  async request(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.reports.request(principal.userId, parseWith(requestSchema, body));
  }

  @Get()
  @PolicyDecorator(FINANCE)
  @ApiOperation({ summary: 'My reports', description: 'Your own report runs, newest first.' })
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.reports.list(principal.userId) };
  }

  @Get(':id')
  @PolicyDecorator(FINANCE)
  @ApiOperation({ summary: 'One report run', description: 'Its status, how many rows it covers, its total, and where to download it when it is ready.' })
  async one(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.view(id);
  }

  @Get(':id/download')
  @PolicyDecorator(FINANCE)
  @ApiOperation({
    summary: 'Download a finished report',
    description: "The built file. Every download is audited: these are the platform's numbers leaving the system. 409 while the report is still building — the run's status is the thing to check, not this."
  })
  async download(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal, @Res() response: Response) {
    const file = await this.reports.download(id, principal.userId);
    response.setHeader('Content-Type', file.filename.endsWith('.pdf') ? 'application/pdf' : XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.end(file.content);
  }
}