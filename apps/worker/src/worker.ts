import 'reflect-metadata';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@smart-home/api/app.module';
import { EnvironmentService } from '@smart-home/api/config/environment.service';
import { MetricsService } from '@smart-home/api/platform/metrics.service';
import { OutboxDispatcher } from '@smart-home/api/platform/outbox.dispatcher';
import { SettingsService } from '@smart-home/api/platform/settings.service';
import { QueueRegistry, REPEATABLE_JOBS } from '@smart-home/api/queues/queue.registry';

export const startWorker = async (): Promise<void> => {
  const environment = new EnvironmentService();
  const context = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const settings = context.get(SettingsService);
  await settings.start();
  const queues = context.get(QueueRegistry);
  const dispatcher = context.get(OutboxDispatcher);
  dispatcher.stop();
  for (const job of REPEATABLE_JOBS) {
    await queues.queue(job.queue).add('repeatable.schedule', { name: job.name, everyMs: job.everyMs }, { jobId: `repeatable:${job.name}`, repeat: { every: job.everyMs } });
  }
  for (const name of new Set(REPEATABLE_JOBS.map(job => job.queue))) {
    await queues.startWorker(name);
  }

  // The API serves `/metrics`, but the jobs that `shm_jobs_total` counts run here, in a separate
  // process, so the API cannot see them. Exposing the worker's own registry is what makes those
  // counters — and the `JobFailureRateHigh` rule built on them — actually observable.
  const metrics = context.get(MetricsService);
  const metricsServer = createServer((request, response) => {
    if (request.method !== 'GET' || (request.url ?? '').split('?')[0] !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    void metrics
      .metrics()
      .then(body => {
        response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
        response.end(body);
      })
      .catch(error => {
        response.writeHead(500).end();
        process.stderr.write(`worker metrics scrape failed: ${error instanceof Error ? error.message : String(error)}\n`);
      });
  });
  const metricsPort = environment.values.WORKER_METRICS_PORT;
  // A metrics port that could not be bound is logged rather than fatal: it means an alert will not
  // fire, which is bad, but taking the workers down over it would be worse.
  metricsServer.on('error', error => process.stderr.write(`worker metrics server could not listen on :${metricsPort}: ${error.message}\n`));
  metricsServer.listen(metricsPort);

  process.stdout.write(`worker ready (node ${process.env.NODE_ENV ?? 'development'}, log level ${environment.values.LOG_LEVEL}, metrics :${metricsPort})\n`);
  const shutdown = async (signal: string): Promise<void> => {
    context.get(OutboxDispatcher).stop();
    await settings.stop();
    await new Promise<void>(resolve => metricsServer.close(() => resolve()));
    await context.close();
    process.stdout.write(`worker received ${signal} and shut down cleanly\n`);
  };
  process.once('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown('SIGTERM').then(() => process.exit(0)));
};

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href;

if (isEntrypoint) {
  void startWorker().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
