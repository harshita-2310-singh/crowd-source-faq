/**
 * instrument.ts — Sentry initialization entry point.
 *
 * IMPORTANT: This file MUST be imported BEFORE any other application code,
 * ideally via `tsx --import ./src/instrument.ts src/server.ts`. This ensures
 * Sentry's auto-instrumentation patches Express + Mongoose before they're
 * imported by the rest of the app. Initializing Sentry inline in bootstrap/app.ts
 * (the previous pattern) caused the v10 SDK to log "express is not instrumented"
 * because route registration happened before the patch was applied.
 *
 * Two Sentry clients are configured here:
 *   - Backend client (SENTRY_DSN): captures HTTP errors, request spans,
 *     unhandled rejections, and logger.error/alert calls.
 *   - DB client (SENTRY_DB_DSN): captures Mongoose spans only. Falls back to
 *     SENTRY_DSN when SENTRY_DB_DSN is unset.
 *
 * PII is filtered via beforeSend + beforeSendTransaction. sendDefaultPii:false
 * keeps IP + user-agent out of events by default.
 */
import * as Sentry from '@sentry/node';
import { expressIntegration, mongooseIntegration } from '@sentry/node';

const sentryEnabled = process.env.SENTRY_ENABLED !== 'false'; // default on
const sentryDsn = process.env.SENTRY_DSN;
const sentryDbDsn = process.env.SENTRY_DB_DSN || sentryDsn;
const sentryEnv = process.env.SENTRY_ENV || process.env.NODE_ENV || 'development';
const sentryRelease = process.env.SENTRY_RELEASE;
const sentryDebug = process.env.SENTRY_DEBUG === 'true';
const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1');

/** Strip PII from outgoing Sentry events. */
function sentryBeforeSend(event: Sentry.ErrorEvent, _hint: Sentry.EventHint): Sentry.ErrorEvent | null {
  if (event.request) {
    if (event.request.headers) {
      const headers = event.request.headers as Record<string, unknown>;
      delete headers['authorization'];
      delete headers['Authorization'];
      delete headers['cookie'];
      delete headers['Cookie'];
    }
    if (event.request.data) delete event.request.data;
    if (event.request.cookies) delete event.request.cookies;
  }
  return event;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sentryBeforeSendTransaction(event: any, _hint: Sentry.EventHint): any {
  if (event.request) {
    if (event.request.headers) {
      const headers = event.request.headers as Record<string, unknown>;
      delete headers['authorization'];
      delete headers['Authorization'];
      delete headers['cookie'];
      delete headers['Cookie'];
    }
    if (event.request.data) delete event.request.data;
    if (event.request.cookies) delete event.request.cookies;
  }
  return event;
}

if (sentryEnabled && sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: sentryEnv,
    release: sentryRelease,
    debug: sentryDebug,
    sendDefaultPii: false,
    tracesSampleRate,
    integrations: [
      expressIntegration(),
      mongooseIntegration(),
    ],
    beforeSend: sentryBeforeSend,
    beforeSendTransaction: sentryBeforeSendTransaction,
  });
}

// Separate client for DB spans — only if a different DSN is configured.
if (sentryEnabled && sentryDbDsn && sentryDbDsn !== sentryDsn) {
  Sentry.init({
    dsn: sentryDbDsn,
    environment: sentryEnv,
    release: sentryRelease,
    debug: sentryDebug,
    sendDefaultPii: false,
    tracesSampleRate,
    integrations: [mongooseIntegration()],
    beforeSend: sentryBeforeSend,
    beforeSendTransaction: sentryBeforeSendTransaction,
  });
}