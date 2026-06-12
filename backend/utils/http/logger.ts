/**
 * logger.ts — Centralized application logger with named instances
 * + Discord webhook forwarder.
 *
 * v1.67 — Adds a typed "named logger" API so each subsystem gets
 * its own prefix (`[auth]`, `[admin]`, `[db]`, `[cron]`, etc.)
 * without sprinkling bracket tags in the call sites. The base
 * `logger` still exists for one-off use.
 *
 * Usage:
 *   import { createLogger } from '../utils/http/logger.js';
 *   const log = createLogger('auth');
 *   log.info('login ok', { userId });
 *   // → [14:23:01.234] [INFO ] [auth] login ok {"userId":"..."}
 *
 * Level hierarchy (most-severe first):
 *   alert  → red+bold,   [ALERT]  → forwards to Discord
 *   error  → red,        [ERROR]  → stderr
 *   warn   → yellow,     [WARN ]  → stdout
 *   info   → blue,       [INFO ]  → stdout
 *
 * Discord setup:
 *   1. Discord channel → Settings → Integrations → Webhooks
 *   2. Create a webhook, copy the URL
 *   3. backend/.env: DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
 *   4. Restart. Missing/empty env → ALERTs still log to console,
 *      just no Discord ping.
 */

type LogLevel = 'info' | 'warn' | 'error' | 'alert';

interface LogInput {
  level: LogLevel;
  category: string;
  message: string;
  meta?: object;
  requestId?: string;
}

const LOG_LEVELS: Record<LogLevel, string> = {
  info:  'INFO',  // 4 chars
  warn:  'WARN',  // 4 chars
  error: 'ERR ',  // 4 chars (trailing space for alignment)
  alert: 'ALRT', // 4 chars (abbreviated so the [TAG] is 4 wide)
};

/**
 * v1.68 — Center a short string inside a fixed-width `[  TAG  ]`
 * box. 6-char inner = 8-char outer. Used for both the level tag
 * and the category tag so the columns line up.
 */
function centerInBox(text: string, innerWidth: number = 6): string {
  if (text.length >= innerWidth) return `[${text}]`;
  const totalPad = innerWidth - text.length;
  const left = Math.floor(totalPad / 2);
  const right = totalPad - left;
  return `[${' '.repeat(left)}${text}${' '.repeat(right)}]`;
}

const C = {
  reset:   (s: string) => `\x1b[0m${s}\x1b[0m`,
  red:     (s: string) => `\x1b[31m${s}\x1b[0m`,
  green:   (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow:  (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue:    (s: string) => `\x1b[34m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  cyan:    (s: string) => `\x1b[36m${s}\x1b[0m`,
  white:   (s: string) => `\x1b[37m${s}\x1b[0m`,
  bold:    (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:     (s: string) => `\x1b[2m${s}\x1b[0m`,
  // Background-colored tags — the level stays on a single line,
  // the tag stands out from the rest of the line.
  bgBlue:   (s: string) => `\x1b[44;97m${s}\x1b[0m`,   // INFO  — blue bg, white text
  bgYellow: (s: string) => `\x1b[43;30m${s}\x1b[0m`,   // WARN  — yellow bg, black text
  bgRed:    (s: string) => `\x1b[41;97m${s}\x1b[0m`,   // ERROR — red bg, white text
  // ALERT uses inverse + bold (red text on white bg) — the
  // most attention-grabbing tag in the system.
  bgAlert:  (s: string) => `\x1b[1;37;41m${s}\x1b[0m`,  // ALERT — bold white on red bg
  boldRed:  (s: string) => `\x1b[1;31m${s}\x1b[0m`,
};

/**
 * Leading symbol per level. One char so the line stays
 * one-line. Pairs with the level tag for redundancy — the
 * symbol gives at-a-glance severity without parsing the tag.
 */
const LEVEL_GLYPHS: Record<LogLevel, string> = {
  info:  '▶',
  warn:  '!',
  error: '✗',
  alert: '‼',
};

const LEVEL_GLYPH_COLORS: Record<LogLevel, (s: string) => string> = {
  info:  C.cyan,
  warn:  C.yellow,
  error: C.red,
  alert: C.boldRed,
};

// v1.68 — L1 sweep: subsystem-specific loggers for the
// remaining user-facing domains.
const CATEGORY_COLORS: Record<string, (s: string) => string> = {
  auth:       C.cyan,
  admin:      C.magenta,
  db:         C.blue,
  cron:       C.green,
  queue:      C.yellow,
  http:       C.dim,
  shutdown:   C.boldRed,
  startup:    C.bold,
  security:   C.boldRed,
  audit:      C.boldRed,
  community:  C.green,
  support:    C.yellow,
};

function coloredCategory(text: string, rawCategory: string): string {
  const fn = CATEGORY_COLORS[rawCategory] ?? C.dim;
  return fn(centerInBox(text));
}

function coloredLevel(level: LogLevel): string {
  const label = centerInBox(LOG_LEVELS[level]);  // 8 chars wide incl brackets
  if (level === 'alert') return C.bgAlert(label);
  if (level === 'error') return C.bgRed(label);
  if (level === 'warn')  return C.bgYellow(label);
  return C.bgBlue(label);  // info
}

function formatLog(entry: LogInput): string {
  const timestamp = new Date().toISOString().slice(11, 23);
  const lvl = coloredLevel(entry.level);
  const glyph = LEVEL_GLYPH_COLORS[entry.level](LEVEL_GLYPHS[entry.level]);
  // Category: truncate to 6 inner chars + '…' if longer, then
  // center. Keeps the column width consistent so the log
  // looks like a table.
  const rawCat = entry.category;
  const catText = rawCat.length > 6 ? rawCat.slice(0, 5) + '…' : rawCat;
  const cat = coloredCategory(catText, rawCat);
  const metaKeys = Object.keys(entry.meta || {});
  const metaStr = metaKeys.length > 0 ? ` ${C.dim(JSON.stringify(entry.meta))}` : '';
  // For ALERT, add separators above + below so it stands out
  // in scrollback. Otherwise the line is one-line + compact.
  const prefix = entry.level === 'alert' ? C.boldRed('━'.repeat(80)) + '\n' + C.boldRed('  ') : '';
  const suffix = entry.level === 'alert' ? '\n' + C.boldRed('━'.repeat(80)) : '';
  return `${prefix}${C.dim(timestamp)} ${glyph} ${lvl} ${cat} ${C.bold(entry.message)}${metaStr}${suffix}`;
}
function emit(entry: LogInput): void {
  const formatted = formatLog(entry);
  if (entry.level === 'error' || entry.level === 'alert') {
    console.error(formatted);
  } else {
    console.log(formatted);
  }
  // Forward alerts to Discord (best-effort, fire-and-forget).
  if (entry.level === 'alert') {
    notifyDiscord(entry.message, entry.meta, entry.category).catch(() => { /* swallow */ });
  }
}

// ─── Logger instance API ─────────────────────────────────────────────────────

export interface Logger {
  info:  (message: string, meta?: object) => void;
  warn:  (message: string, meta?: object) => void;
  error: (message: string, meta?: object) => void;
  alert: (message: string, meta?: object) => void;
  /**
   * Security audit — writes at ALERT level (forwarded to Discord)
   * and tags the log line with [AUDIT]. Available on every named
   * logger so the call site reads e.g. `adminLog.audit('banned
   * user', { userId })` instead of having to import the bare
   * `logger.audit`.
   */
  audit: (action: string, meta?: Record<string, unknown>) => void;
  /** With requestId (from AsyncLocalStorage context) */
  child: (requestId: string) => Logger;
}

/**
 * Create a named logger. Each subsystem should have ONE and
 * import it at the top of its files. The `category` is the
 * bracketed prefix you see in the log line.
 *
 *   const log = createLogger('auth');
 *   log.alert('banned login attempt', { email, ip });
 */
export function createLogger(category: string): Logger {
  const make = (requestId?: string): Logger => {
    const o: Logger = {
      info:  (message, meta) => emit({ level: 'info',  category, message, meta, requestId }),
      warn:  (message, meta) => emit({ level: 'warn',  category, message, meta, requestId }),
      error: (message, meta) => emit({ level: 'error', category, message, meta, requestId }),
      alert: (message, meta) => emit({ level: 'alert', category, message, meta, requestId }),
      audit: (action, meta) => emit({
        level: 'alert',
        category,
        message: `[AUDIT] ${action}`,
        meta: { action, timestamp: new Date().toISOString(), ...meta },
        requestId,
      }),
      child: (rid: string) => make(rid),
    };
    return o;
  };
  return make();
}

// ─── Pre-built loggers for the major subsystems ─────────────────────────────

export const authLog     = createLogger('auth');
export const adminLog    = createLogger('admin');
export const dbLog       = createLogger('db');
export const cronLog     = createLogger('cron');
export const queueLog    = createLogger('queue');
export const httpLog     = createLogger('http');
export const startupLog  = createLogger('startup');
export const shutdownLog = createLogger('shutdown');
export const securityLog = createLogger('security');
// v1.68 — L1 sweep: subsystem-specific loggers for the remaining
// user-facing domains. communityLog covers post + comment +
// public FAQ reads. supportLog covers the user-facing support
// ticket + golden-ticket flow. queueLog (already present)
// covers the BullMQ job worker.
export const communityLog = createLogger('community');
export const supportLog   = createLogger('support');

// ─── Generic logger (for one-off use; consider createLogger instead) ────────

interface LogWithRequestId extends LogInput { requestId: string; }

function logWithRequestId(requestId: string, input: Omit<LogInput, 'category'> & { category?: string }): void {
  emit({ ...input, category: input.category ?? '-', requestId });
}

const log = (input: Omit<LogInput, 'category'> & { category?: string }, requestId?: string): void => {
  logWithRequestId(requestId || '-', input);
};

export const logger = {
  info:  (message: string, meta?: object, requestId?: string) =>
    logWithRequestId(requestId || '-', { level: 'info', message, meta }),
  warn:  (message: string, meta?: object, requestId?: string) =>
    logWithRequestId(requestId || '-', { level: 'warn', message, meta }),
  error: (message: string, meta?: object, requestId?: string) =>
    logWithRequestId(requestId || '-', { level: 'error', message, meta }),
  /**
   * v1.67 — ALERT level. Red+bold, [ALERT] tag, forwarded to Discord
   * when DISCORD_WEBHOOK_URL is set. Use for security-relevant events:
   * server start/stop, DB disconnect, banned login attempts, admin
   * resolve/reject/ban, etc.
   */
  alert: (message: string, meta?: object, requestId?: string) =>
    logWithRequestId(requestId || '-', { level: 'alert', message, meta }),
  /**
   * Audit log for security-sensitive admin actions. Always at ALERT
   * level so it stands out AND forwards to Discord.
   */
  audit: (action: string, meta?: Record<string, unknown>) =>
    logWithRequestId('-', {
      level: 'alert',
      message: `[AUDIT] ${action}`,
      meta: { action, timestamp: new Date().toISOString(), ...meta },
    }),
  notifyDiscord,
};

// ─── Discord webhook forwarder ────────────────────────────────────────────────

interface DiscordEmbedField { name: string; value: string; inline?: boolean; }
interface DiscordEmbed { title: string; color: number; fields: DiscordEmbedField[]; timestamp: string; footer: { text: string }; }
interface DiscordPayload { username: string; embeds: DiscordEmbed[]; }

let webhookUrl: string | null = null;
let webhookConfigured = false;

function getWebhookUrl(): string | null {
  if (webhookConfigured) return webhookUrl;
  webhookUrl = (process.env.DISCORD_WEBHOOK_URL ?? '').trim() || null;
  webhookConfigured = true;
  return webhookUrl;
}

const DISCORD_COLORS: Record<LogLevel, number> = {
  alert: 0xCC2222,
  error: 0xE67E22,
  warn:  0xF1C40F,
  info:  0x3498DB,
};

async function notifyDiscord(message: string, meta?: object, category?: string): Promise<void> {
  const url = getWebhookUrl();
  if (!url) return;

  const fields: DiscordEmbedField[] = [];
  if (category) fields.push({ name: 'category', value: category, inline: true });
  if (meta && typeof meta === 'object') {
    for (const [k, v] of Object.entries(meta)) {
      const str = typeof v === 'string' ? v : JSON.stringify(v);
      fields.push({ name: k, value: str.length > 1024 ? str.slice(0, 1000) + '…' : str, inline: false });
    }
  }

  const payload: DiscordPayload = {
    username: 'Yaksha Logger',
    embeds: [{
      title: `[ALERT] ${message}`.slice(0, 240),
      color: DISCORD_COLORS.alert,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: 'Yaksha FAQ Portal' },
    }],
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[logger] Discord webhook returned ${res.status}`);
    }
  } catch (e) {
    console.error(`[logger] Discord webhook failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(t);
  }
}

export type { LogLevel, LogInput, LogWithRequestId };
export default log;
