import './env.js';
import { validateEnv } from './config/envValidator.js';
import { loadConfig } from './config/loader.js';
import { createApp } from './bootstrap/app.js';
import { startup, stopAllSchedulers } from './bootstrap/startup.js';
import { startupLog, shutdownLog, logger } from './utils/http/logger.js';
import * as Sentry from '@sentry/node';

// Validate environment variables first
validateEnv();

const config = loadConfig();
const app = createApp(config);
const PORT = parseInt(process.env.PORT || String(config.server.port), 10);

if (config.server.env !== 'production') {
  app.listen(PORT, '0.0.0.0', async () => {
    startupLog.alert('backend listening', {
      port: PORT,
      env: config.server.env,
      nodeVersion: process.version,
    });
    startupLog.info(`Yaksha FAQ Portal backend running on port ${PORT}`);

    await startup(config);
  });
}

// Graceful shutdown handling
async function gracefulShutdown(signal: string): Promise<void> {
  shutdownLog.alert('shutdown initiated', { signal });
  Sentry.close(2000).catch((err) => {
    logger.warn(`[shutdown] Sentry flush failed: ${(err as Error).message}`);
  });

  await stopAllSchedulers();
  shutdownLog.info('graceful shutdown complete');
}

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM').finally(() => process.exit(0));
});
process.on('SIGINT', () => {
  gracefulShutdown('SIGINT').finally(() => process.exit(0));
});

export default app;