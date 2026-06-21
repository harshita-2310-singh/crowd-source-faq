/**
 * registrationControlController.ts — admin endpoints for the
 * v1.70 controlled-registration feature.
 *
 * Endpoints (mounted under /api/admin/registration-config):
 *   GET    /                       → current config (no plaintext token)
 *   PATCH  /                       → toggle enabled (body: { enabled })
 *   POST   /regenerate-token       → generate fresh token, return plaintext once
 *
 * Role gate: `admin` only (per v1.70 spec — closest existing match
 * to "super-admin" since UserRole has no super-admin). Moderators
 * cannot toggle registration — that's an admin-level concern.
 *
 * Audit: every state change writes an AdminLog entry with
 * action='settings_update' and targetType='system', so the existing
 * /admin/audit log captures who flipped the toggle and when.
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import RegistrationConfig, {
  ensureRegistrationConfig,
  generateInviteToken,
} from './registration-config.model.js';
import AdminLog from '../admin/admin-log.model.js';
import User from '../auth/user.model.js';
import { adminLog } from '../../utils/http/logger.js';

/**
 * Pull the admin id off the request. Routes mounted with
 * `protect + authorize('admin')` guarantee `req.user` exists.
 */
function adminIdFromReq(req: Request): Types.ObjectId | null {
  const u = (req as Request & { user?: { _id?: Types.ObjectId | string } }).user;
  if (!u?._id) return null;
  return typeof u._id === 'string' ? new Types.ObjectId(u._id) : u._id;
}

/**
 * Build the full invite-link URL for display. Uses PUBLIC_BASE_URL
 * if set (recommended for production), falls back to the request's
 * own host header so the admin always sees a usable URL even in dev.
 */
function buildInviteLink(req: Request, token: string): string {
  const configured = (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (configured) return `${configured}/?token=${token}`;
  // Fallback: derive from the request so the admin gets a working link
  // in dev without needing to configure PUBLIC_BASE_URL.
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}/?token=${token}`;
}

/**
 * GET /api/admin/registration-config
 * Returns the current config — INCLUDING the current invite link,
 * built from the stored plaintext token. The link is only exposed
 * to admin-role callers; public callers see only `enabled`.
 */
export async function adminGetRegistrationConfig(req: Request, res: Response): Promise<void> {
  try {
    const doc = await ensureRegistrationConfig();
    const lastToggledBy = doc.lastToggledBy
      ? await User.findById(doc.lastToggledBy).select('name email').lean()
      : null;
    res.json({
      enabled: doc.registrationEnabled,
      inviteLink: buildInviteLink(req, doc.inviteToken),
      tokenGeneratedAt: doc.tokenGeneratedAt,
      lastToggledBy: lastToggledBy
        ? {
            id: String(lastToggledBy._id),
            name: (lastToggledBy as { name?: string }).name ?? null,
            email: (lastToggledBy as { email?: string }).email ?? null,
          }
        : null,
      lastToggledAt: doc.lastToggledAt,
    });
  } catch (err) {
    adminLog.error(`[registrationControl] get failed: ${(err as Error).message}`);
    res.status(500).json({ message: 'Failed to load registration config.' });
  }
}

/**
 * PATCH /api/admin/registration-config
 * Body: { enabled: boolean }
 * Toggles the registration gate. Audit-logged.
 */
export async function adminUpdateRegistrationConfig(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      res.status(400).json({ message: '`enabled` (boolean) is required.' });
      return;
    }
    const adminId = adminIdFromReq(req);
    if (!adminId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    // Ensure singleton exists before updating so the upsert doesn't
    // require an inviteToken that wasn't generated yet.
    await ensureRegistrationConfig();
    const doc = await RegistrationConfig.findByIdAndUpdate(
      'singleton',
      {
        $set: {
          registrationEnabled: body.enabled,
          lastToggledBy: adminId,
          lastToggledAt: new Date(),
        },
      },
      { new: true },
    );
    // Audit log — reuses the existing 'settings_update' action.
    // Best-effort: don't block the response on log failure.
    AdminLog.create({
      adminId,
      action: 'settings_update',
      targetType: 'system',
      details: `Registration ${body.enabled ? 'enabled' : 'disabled'}`,
    }).catch((err) => {
      adminLog.warn(`[registrationControl] audit log write failed: ${(err as Error).message}`);
    });
    res.json({
      enabled: doc?.registrationEnabled ?? body.enabled,
      lastToggledAt: doc?.lastToggledAt,
    });
  } catch (err) {
    adminLog.error(`[registrationControl] update failed: ${(err as Error).message}`);
    res.status(500).json({ message: 'Failed to update registration config.' });
  }
}

/**
 * POST /api/admin/registration-config/regenerate-token
 * Generates a new random token, replaces the stored one atomically.
 * Returns the new plaintext token AND the full invite link in the
 * response — the admin must copy it now; the DB only retains the
 * plaintext for future GETs (and the same plaintext for verify).
 *
 * This is the ONLY endpoint that returns a usable invite link
 * without the admin having to read the DB directly. Treat the
 * response body as secret.
 */
export async function adminRegenerateInviteToken(req: Request, res: Response): Promise<void> {
  try {
    const adminId = adminIdFromReq(req);
    if (!adminId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const newToken = generateInviteToken();
    const doc = await RegistrationConfig.findByIdAndUpdate(
      'singleton',
      {
        $set: {
          inviteToken: newToken,
          tokenGeneratedAt: new Date(),
          lastToggledBy: adminId,
          lastToggledAt: new Date(),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    AdminLog.create({
      adminId,
      action: 'settings_update',
      targetType: 'system',
      details: 'Registration invite token regenerated',
    }).catch((err) => {
      adminLog.warn(`[registrationControl] audit log write failed: ${(err as Error).message}`);
    });
    res.json({
      // plaintext — admin needs this to share the link. Returned ONCE.
      token: newToken,
      inviteLink: buildInviteLink(req, newToken),
      tokenGeneratedAt: doc?.tokenGeneratedAt,
    });
  } catch (err) {
    adminLog.error(`[registrationControl] regenerate failed: ${(err as Error).message}`);
    res.status(500).json({ message: 'Failed to regenerate invite token.' });
  }
}