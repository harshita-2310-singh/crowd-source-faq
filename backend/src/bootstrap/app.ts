import express, { Express, Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/node';
import { expressIntegration } from '@sentry/node';
import mongoose from 'mongoose';
import { registerMiddleware } from './middleware.js';
import { registerRoutes } from './routes.js';
import { getMetrics } from '../utils/http/metrics.js';
import { logger } from '../utils/http/logger.js';

export function createApp(config: any): Express {
  // Initialize Sentry
  if (config.observability.sentry.enabled) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: config.server.env,
      integrations: [
        expressIntegration(),
      ],
      tracesSampleRate: config.observability.sentry.tracesSampleRate,
    });
  }

  // Track unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    Sentry.captureException(reason);
  });

  const app = express();

  // Register all middlewares
  registerMiddleware(app, config);

  // Register all routes
  registerRoutes(app);

  // Mount special utility endpoints
  app.get('/api/health', async (req: Request, res: Response) => {
    let dbStatus = 'disconnected';
    try {
      const conn = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
      if (conn === 'connected') {
        await mongoose.connection.db!.admin().ping();
        dbStatus = 'connected';
      }
    } catch (err) {
      logger.warn(`[server] Health check DB ping failed: ${(err as Error).message}`);
      dbStatus = 'error';
    }
    res.json({
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      db: dbStatus,
      version: '0.1.0',
    });
  });

  app.post('/api/warm', async (_req: Request, res: Response) => {
    try {
      await import('../utils/ai/embeddings.js').then(m => m.warmEmbedder());
      res.json({ status: 'warmed' });
    } catch {
      res.status(500).json({ status: 'warm failed' });
    }
  });

  app.get('/api/metrics', async (_req: Request, res: Response) => {
    try {
      const metrics = getMetrics();
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(metrics);
    } catch (err) {
      res.status(500).json({ message: 'metrics unavailable' });
    }
  });

  // Global Error Handler
  app.use((err: { status?: number; message?: string; stack?: string }, req: Request, res: Response, next: NextFunction) => {
    const requestId: string = (req as Request & { id: string }).id || '-';
    Sentry.captureException(err);
    logger.error(err.stack || err.message || 'Unknown error', { status: err.status }, requestId);
    res.status(err.status || 500).json({
      message: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { error: err.message, stack: err.stack })
    });
  });

  return app;
}
