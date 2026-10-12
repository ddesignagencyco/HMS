// apps/api/src/admin/ops-board.controller.ts
import { Controller, Get, Inject, Res, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PolicyDecorator } from '../common/policy.js';
import { OpsBoardService } from './ops-board.service.js';

const FINANCE = { roles: ['FINANCE', 'ADMIN'], totpRequired: true } as const;

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/ops-board')
export class OpsBoardController {
  constructor(@Inject(OpsBoardService) private readonly board: OpsBoardService) {}

  @Get()
  @PolicyDecorator(FINANCE)
  @ApiOperation({
    summary: 'The operations board',
    description:
      'One screen for what is happening right now: bookings today by status, how deep each background queue is, how many verifications and complaints have blown their SLA, open disputes, escrow held, and how many providers are blocked for commission debt. Every figure is queried from the table it describes, never kept up to date incrementally — an ops board that has quietly drifted from the thing it reports is worse than none. Money is reported as a string of paisa, never a number, for the same reason as everywhere else. `alerts` is sorted worst-first so the top of the list is where to start.'
  })
  async get() {
    return this.board.current();
  }

  /**
   * FR-AD-12's "pushed on `ops-board`", delivered as Server-Sent Events rather than a WebSocket.
   *
   * The ticket says WebSocket, and there is no WebSocket transport anywhere in this system — SHM-081's
   * Socket.IO notification centre is listed as scope and was never built. Introducing one transport for
   * a single stream, on a Fastify/Express stack that has none, would have been a new dependency, a new
   * lifecycle to own and a new way for the API to fail, in exchange for pushing the same bytes. SSE is
   * the same HTTP stack, reconnects on its own in every browser, and is one-directional — which is all
   * a board needs. Deviation recorded rather than made quietly.
   */
  @Sse('stream')
  @PolicyDecorator(FINANCE)
  @ApiOperation({
    summary: 'The operations board, live',
    description:
      'The same board as `GET /admin/ops-board`, pushed as Server-Sent Events. The board is recomputed on a single shared five-second cadence no matter how many streams are open — one operator with six tabs open costs the database one recompute, not six — so an update reaches a connected client within five seconds of the underlying change. The first event arrives immediately.'
  })
  async stream(@Res() response: Response) {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();

    const write = (board: unknown): void => {
      response.write(`event: board\ndata: ${JSON.stringify(board)}\n\n`);
    };

    write(await this.board.current());
    const unsubscribe = this.board.subscribe(write);
    response.on('close', unsubscribe);
    // Nothing to await: the response stays open until the client goes away.
    return undefined;
  }
}