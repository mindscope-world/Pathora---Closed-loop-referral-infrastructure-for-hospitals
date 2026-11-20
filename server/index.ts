import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { startExportWorker } from './jobs/exportWorker';
import { startSlaMonitor } from './jobs/slaMonitor';
import { startMessageWorker } from './jobs/messageWorker';
import { startRetentionPurge } from './jobs/retentionPurge';
import { startReportScheduler } from './jobs/reportScheduler';

const app = createApp();
const onListening = () => {
  logger.info({ port: env.PORT, host: env.HOST ?? 'default', address: server.address(), env: env.NODE_ENV }, 'Pathora API listening');
};
const server = env.HOST ? app.listen(env.PORT, env.HOST, onListening) : app.listen(env.PORT, onListening);
const stopExportWorker = startExportWorker();
const stopSlaMonitor = startSlaMonitor();
const stopMessageWorker = startMessageWorker();
const stopReportScheduler = startReportScheduler();
const stopRetentionPurge = startRetentionPurge();

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  stopExportWorker();
  stopSlaMonitor();
  stopMessageWorker();
  stopReportScheduler();
  stopRetentionPurge();
  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
    // Later phases: close Prisma and pg-boss here.
    process.exit(0);
  });
  // Force-exit if connections refuse to drain.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Unhandled rejection'));
