/**
 * Writes the full OpenAPI document to a committed file so the frontend can
 * codegen against it offline — no running API, no shared environment.
 *
 * The document is produced by the same path production serves: `configureHttpApp`
 * calls `SwaggerModule.createDocument(app, buildOpenApiConfig())` (and serves the
 * result at `/api/docs/openapi.json`), and this script calls exactly that function
 * on the same app it builds, so the committed JSON cannot drift from what an
 * integration test boots.
 *
 * The API surface snapshot (`api-surface.ts`) keeps proving that refactors do not
 * move or drop endpoints; this file exists for the frontend, which needs the full
 * schemas, not just the operation list.
 */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHttpAdapter } from '../src/adapter.js';
import { AppModule } from '../src/app.module.js';
import { EnvironmentService } from '../src/config/environment.service.js';
import { buildOpenApiConfig, configureHttpApp, registerHttpPlugins } from '../src/http-app.js';
import { SettingsService } from '../src/platform/settings.service.js';

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href;

export const readOpenApiDocument = async (): Promise<Record<string, unknown>> => {
  const environment = new EnvironmentService();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, createHttpAdapter(), { bufferLogs: true, logger: false, rawBody: true });

  await registerHttpPlugins(app, environment);
  configureHttpApp(app, environment);
  await app.init();

  const document = SwaggerModule.createDocument(app, buildOpenApiConfig()) as unknown as Record<string, unknown>;
  await app.get(SettingsService).stop().catch(() => undefined);
  await app.close();
  return document;
};

if (isEntrypoint) {
  const document = await readOpenApiDocument();
  // Defaults to docs-final, where the frontend handoff lives.
  const target = resolve(process.cwd(), process.argv[2] ?? '../../docs-final/openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  const paths = Object.keys((document.paths as Record<string, unknown>) ?? {}).length;
  process.stdout.write(`wrote OpenAPI document (${paths} paths) to ${target}\n`);
  // Redis and BullMQ hold open handles that would keep the process alive
  // forever once Nest has closed; the document is already on disk.
  process.exit(0);
}