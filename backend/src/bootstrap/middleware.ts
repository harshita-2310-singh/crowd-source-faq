import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { v4 as uuidv4 } from 'uuid';
import connectDB from '../config/db.js';
import { runWithContext } from '../utils/http/requestContext.js';
import { requestLogger } from '../utils/http/requestLogger.js';
import { ingestFrontendLog } from '../utils/http/fileLogger.js';

export function registerMiddleware(app: Express, config: any): void {
  // 1. Trust the proxy hops
  app.set('trust proxy', config.server.trustProxyHops);

  // 2. Database connection middleware (lazy DB check)
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      await connectDB();
      next();
    } catch (err) {
      next(err);
    }
  });

  // 3. Request ID + Context tracking context propagation
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = uuidv4();
    (req as Request & { id: string }).id = requestId;
    res.setHeader('X-Request-ID', requestId);

    const ctx = { requestId, userId: (req as Request & { user?: { id: string } }).user?.id };
    runWithContext(ctx, async () => { next(); });
  });

  // 4. Request logging
  app.use(requestLogger);

  // 5. Dynamic CORS Configuration
  const allowedOrigins = [...config.cors.allowedOrigins];
  if (process.env.CLIENT_URL) allowedOrigins.push(process.env.CLIENT_URL);

  app.use(cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      const isVercelPreview = config.cors.allowVercelPreviews && config.server.env !== 'production' && origin.endsWith('.vercel.app');
      const isLocalhost = config.cors.allowLocalhostInDev && config.server.env !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      
      if (allowedOrigins.indexOf(origin) !== -1 || isVercelPreview || isLocalhost) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: config.cors.credentials,
  }));

  // 6. Security headers via Helmet
  app.use(helmet({
    crossOriginResourcePolicy: false,
  }));

  // 7. Body Parsing
  app.use(express.json());

  // 8. Minimal Cookie parser
  app.use((req: Request, _res: Response, next: (e?: unknown) => void) => {
    const header = req.headers.cookie;
    if (!header) { next(); return; }
    const jar: Record<string, string> = {};
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (!k) continue;
      try { jar[k] = decodeURIComponent(v); } catch { /* malformed */ }
    }
    (req as Request & { cookies: Record<string, string> }).cookies = jar;
    next();
  });

  // Serve static uploads
  app.use('/uploads', express.static('uploads'));

  // Frontend log endpoint
  app.post('/api/log', ingestFrontendLog);
}
