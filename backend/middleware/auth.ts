import { type Request, type Response, type NextFunction } from 'express';
import { verifyAndLoadUser, authorize, type AuthedRequest } from './authShared.js';

// Re-export the legacy `authorize` factory so callers that import it from
// './middleware/auth.js' keep working.
export { authorize };

// `protect` — verify JWT, check blocklist, attach user, then call next().
// On failure verifyAndLoadUser writes the 401 response and returns null;
// we short-circuit so next() doesn't run.
export const protect = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const user = await verifyAndLoadUser(req as AuthedRequest, res);
  if (!user) return;
  next();
};
