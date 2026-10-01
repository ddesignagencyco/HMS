// apps/api/scripts/dev-at.ts
//
// Development only: runs the API with the application clock (`AppClock`) set to a chosen Pakistan time, so rules that depend on the hour —
// verification calling hours (08:00–22:00), time bands, SLA counting — can be exercised at any hour of the day. Real time keeps running from
// that starting point. Usage:  npm run dev:at --workspace @smart-home/api -- 10:30 [port]
import 'reflect-metadata';
import { bootstrap } from '../src/main.js';
import { AppClock } from '../src/platform/app-clock.js';

const [time = '10:30', port] = process.argv.slice(2);
const match = /^(\d{1,2}):(\d{2})$/.exec(time);
if (match === null) {
  process.stderr.write('Usage: dev-at.ts HH:MM [port]   (Pakistan time, e.g. 10:30)\n');
  process.exit(2);
}
if (port !== undefined) process.env.PORT = port;

const hour = Number(match[1]);
const minute = Number(match[2]);
const now = new Date();
let target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour - 5, minute));
if (target.getTime() < now.getTime()) target = new Date(target.getTime() + 24 * 3_600_000);

void bootstrap().then(app => {
  app.get(AppClock).travelTo(target);
  process.stdout.write(`API up on port ${process.env.PORT ?? '3000'}; application clock set to ${time} Pakistan time (${target.toISOString()})\n`);
});
