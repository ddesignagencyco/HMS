// apps/api/scripts/api-handoff-index.ts
// Regenerates the generated section of docs-final/API_HANDOFF.md.
//
// The handoff has two kinds of content, and this script owns only the mechanical
// half. The judgement half -- per-screen contracts, the traps, the state machines --
// is hand-written and must not be regenerated away. The two live in separate files so
// that regenerating is safe:
//
//   docs-final/API_HANDOFF.md         hand-written, includes the generated one
//   docs-final/api-handoff-index.md   generated, do not edit
//
// REGENERATE THIS WHENEVER AN API IS ADDED OR CHANGED. It is derived from the live
// application, so if you add an endpoint and skip this, the index silently omits it
// and a frontend developer builds against a contract that does not exist. There is no
// test enforcing that -- it is a rule to keep, not a check to pass.
import { writeFileSync } from 'node:fs';
import { readSurface, type ApiSurface } from './api-surface.js';
import { resolve } from 'node:path';

const OUTPUT = resolve(process.cwd(), process.argv[2] ?? '../../docs-final/api-handoff-index.md');

/** Who a screen belongs to, inferred from the path. Presentation only, so it errs towards AUTHENTICATED. */
const ROLE_OF = (path: string): string => {
  if (path.includes('/admin/')) return 'ADMIN';
  if (path.startsWith('/api/v1/agent/')) return 'AGENT';
  if (path.startsWith('/api/v1/finance/')) return 'FINANCE';
  if (path.startsWith('/api/v1/provider/')) return 'PROVIDER';
  if (path.startsWith('/api/v1/customer/')) return 'CUSTOMER';
  // Health probes and the welcome route are genuinely unauthenticated.
  if (path === '/' || path.startsWith('/health')) return 'PUBLIC';
  // The auth routes that genuinely need no token; `auth/me` and `auth/totp` do.
  if (/^\/api\/v1\/auth\/(login|register|otp\/request|otp\/verify|password\/forgot|password\/reset|refresh|logout)$/.test(path)) return 'PUBLIC';
  return 'AUTHENTICATED';
};

/**
 * Groups that read as an order of work for a frontend team.
 *
 * Deliberately mutually exclusive and in priority order: each operation appears in
 * exactly one group. Overlapping filters were tried first and duplicated the admin
 * complaint and dispute routes across two tables, which would have implied the
 * frontend should call them twice.
 */
const isAdminPath = (path: string): boolean => path.startsWith('/api/v1/admin/');

const GROUPS: readonly { title: string; filter: (operation: ApiSurface['operations'][number]) => boolean }[] = [
  { title: 'Identity & sessions', filter: operation => operation.tags.includes('auth') },
  { title: 'Catalogue & places (public browsing)', filter: operation => operation.tags.includes('catalogue') && !isAdminPath(operation.path) && !operation.path.startsWith('/api/v1/provider/') },
  { title: 'Search & reputation (public)', filter: operation => operation.tags.includes('search') || operation.path.startsWith('/api/v1/search/') },
  { title: 'Customer profile & addresses', filter: operation => operation.tags.includes('customer') },
  { title: 'Booking lifecycle', filter: operation => operation.tags.includes('booking') && operation.path.startsWith('/api/v1/bookings') },
  { title: 'Provider offers & job execution', filter: operation => operation.tags.includes('booking') && operation.path.startsWith('/api/v1/provider/offers') },
  { title: 'Provider onboarding & availability', filter: operation => operation.tags.includes('provider') && operation.path.startsWith('/api/v1/provider') && !operation.path.includes('/provider/services') },
  { title: 'Provider services & pricing', filter: operation => operation.tags.includes('catalogue') && operation.path.startsWith('/api/v1/provider/services') },
  { title: 'Uploads (presigned targets)', filter: operation => operation.path.startsWith('/api/v1/uploads/') },
  { title: 'Provider money', filter: operation => operation.tags.includes('payment') },
  { title: 'Verification agent console', filter: operation => operation.tags.includes('verification') && operation.path.startsWith('/api/v1/agent') },
  { title: 'Customer verification link', filter: operation => operation.path.startsWith('/api/v1/v/') },
  { title: 'Provider reputation & conduct', filter: operation => operation.tags.includes('reputation') || operation.path.includes('/provider/conduct') || operation.path.includes('/provider/penalties') },
  { title: 'Complaints (raised by either party)', filter: operation => operation.tags.includes('complaints') && !isAdminPath(operation.path) },
  { title: 'Disputes (a provider sees these)', filter: operation => operation.tags.includes('disputes') && !isAdminPath(operation.path) },
  { title: 'Finance', filter: operation => operation.tags.includes('finance') || operation.path.startsWith('/api/v1/finance/') },
  { title: 'Admin: catalogue & providers', filter: operation => operation.path.startsWith('/api/v1/admin/catalogue') || operation.path.startsWith('/api/v1/admin/provider-services') || operation.path.startsWith('/api/v1/admin/providers') || operation.path.startsWith('/api/v1/admin/documents') },
  { title: 'Admin: complaints, disputes & conduct', filter: operation => operation.path.startsWith('/api/v1/admin/complaints') || operation.path.startsWith('/api/v1/admin/disputes') || operation.path.startsWith('/api/v1/admin/penalties') || operation.path.startsWith('/api/v1/admin/appeals') },
  { title: 'Admin: templates, settings & notifications', filter: operation => operation.path.startsWith('/api/v1/admin/templates') || operation.path.startsWith('/api/v1/admin/settings') || operation.path.startsWith('/api/v1/admin/notifications') },
  { title: 'Notification centre', filter: operation => operation.path.startsWith('/api/v1/notifications') },
  { title: 'Places (cities & areas)', filter: operation => operation.tags.includes('places') },
  { title: 'Provider-webhook callbacks (never called by the frontend)', filter: operation => operation.path.startsWith('/api/v1/webhooks/') },
  { title: 'Development-only mocks', filter: operation => operation.tags.includes('development') },
  { title: 'Health & welcome', filter: operation => operation.tags.includes('health') || operation.path === '/' }
];

const surface = await readSurface();

const escapePipes = (value: string): string => value.replaceAll('|', '\\|').replaceAll('\n', ' ').trim();

const lines: string[] = [
  '<!-- GENERATED FILE - DO NOT EDIT.',
  '     Produced by `npm run api:handoff --workspace @smart-home/api`, from the live application.',
  '     Re-run it whenever an API is added or changed, and edit API_HANDOFF.md for the contracts. -->',
  '',
  `# API index — ${surface.operations.length} operations`,
  '',
  `Generated ${new Date().toISOString().slice(0, 10)} from version \`${surface.info.version}\`. Base path \`${surface.globalPrefix}\`;`,
  `OpenAPI at \`${surface.docsPath}\`. This table is the exhaustive list; \`API_HANDOFF.md\` adds the contracts you cannot`,
  'infer from a path.',
  ''
];

const placed = new Set<string>();

for (const group of GROUPS) {
  // First match wins, so an operation can never be listed in two groups however the
  // filters are later edited.
  const operations = surface.operations
    .filter(operation => !placed.has(`${operation.method} ${operation.path}`) && group.filter(operation))
    .sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
  if (operations.length === 0) continue;
  lines.push(`## ${group.title}`, '', '| Operation | Role | Summary |', '|---|---|---|');
  for (const operation of operations) {
    placed.add(`${operation.method} ${operation.path}`);
    lines.push(`| \`${operation.method.toUpperCase()} ${operation.path}\` | ${ROLE_OF(operation.path)} | ${escapePipes(operation.summary ?? '')} |`);
  }
  lines.push('');
}

// Anything a group missed still gets listed, so the index can never silently omit an
// endpoint. A non-zero count here means the GROUPS table above needs a new entry.
const ungrouped = surface.operations.filter(operation => !placed.has(`${operation.method} ${operation.path}`));
if (ungrouped.length > 0) {
  lines.push('## Other operations', '', '| Operation | Role | Summary |', '|---|---|---|');
  for (const operation of ungrouped) {
    placed.add(`${operation.method} ${operation.path}`);
    lines.push(`| \`${operation.method.toUpperCase()} ${operation.path}\` | ${ROLE_OF(operation.path)} | ${escapePipes(operation.summary ?? '')} |`);
  }
  lines.push('');
}

writeFileSync(OUTPUT, `${lines.join('\n').trimEnd()}\n`);
process.stdout.write(`wrote ${placed.size} of ${surface.operations.length} operations (${ungrouped.length} ungrouped) to ${OUTPUT}\n`);
// Redis and BullMQ hold open handles that would keep the process alive forever once
// Nest has closed; the index is already on disk. Same reason as `api-surface.ts`.
process.exit(0);