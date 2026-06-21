import { logger } from '../utils/http/logger.js';
import { getCloudinaryConfig } from '../integrations/cloudinary/cloudinary.js';

export function validateEnv(): void {
  const errors: string[] = [];

  // Required: MONGODB_URI
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    errors.push('MONGODB_URI is required');
  } else if (!/^mongodb(\+srv)?:\/\/.+/.test(mongoUri)) {
    errors.push('MONGODB_URI must be a mongodb:// or mongodb+srv:// URL');
  }

  // Required: JWT_SECRET
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    errors.push('JWT_SECRET is required');
  } else if (jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }

  // Recommendation warning logs
  if (!process.env.ENCRYPTION_MASTER_KEY) {
    logger.warn('[validateEnv] ENCRYPTION_MASTER_KEY not set — falling back to JWT_SECRET for AES. Add a dedicated key to enable independent rotation.');
  }
  if (!process.env.OAUTH_STATE_SECRET) {
    logger.warn('[validateEnv] OAUTH_STATE_SECRET not set — falling back to JWT_SECRET for OAuth state HMAC. Add a dedicated key to enable independent rotation.');
  }

  // Optional: PORT
  const port = process.env.PORT;
  if (port !== undefined && !/^\d+$/.test(port)) {
    errors.push('PORT must be numeric');
  }

  // Optional: CLIENT_URL
  const clientUrl = process.env.CLIENT_URL;
  if (clientUrl !== undefined && !/^https?:\/\/.+/.test(clientUrl)) {
    errors.push('CLIENT_URL must be a valid http:// or https:// URL');
  }

  // Optional: REDIS_URL
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl !== undefined) {
    if (!/^https?:\/\/.+/.test(redisUrl)) {
      errors.push('REDIS_URL must be a valid URL');
    }
    if (!process.env.REDIS_TOKEN) {
      errors.push('REDIS_TOKEN is required when REDIS_URL is provided');
    }
  }

  // Optional: Zoom OAuth
  const zoomClientId = process.env.ZOOM_CLIENT_ID;
  const zoomClientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (zoomClientId !== undefined && zoomClientSecret === undefined) {
    errors.push('ZOOM_CLIENT_SECRET is required when ZOOM_CLIENT_ID is provided');
  }
  if (zoomClientSecret !== undefined && zoomClientId === undefined) {
    errors.push('ZOOM_CLIENT_ID is required when ZOOM_CLIENT_SECRET is provided');
  }
  const redirectUri = process.env.ZOOM_REDIRECT_URI;
  if (redirectUri !== undefined && !/^https?:\/\/.+/.test(redirectUri)) {
    errors.push('ZOOM_REDIRECT_URI must be a valid URL');
  }

  if (process.env.NODE_ENV !== 'development' && !process.env.ZOOM_WEBHOOK_SECRET_TOKEN) {
    errors.push('ZOOM_WEBHOOK_SECRET_TOKEN is required in non-development environments');
  }

  try {
    getCloudinaryConfig();
  } catch (e: any) {
    errors.push(e.message);
  }

  if (errors.length > 0) {
    logger.error('Environment validation failed:');
    errors.forEach(e => logger.error(`  - ${e}`));
    process.exit(1);
  }
}
