import { logger, startupLog } from '../utils/http/logger.js';
import connectDB from '../config/db.js';
import { migrateZoomSettingsToSessions } from '../utils/zoomMigration.js';
import { startBot, stopBot } from '../integrations/discord/discordBot.js';
import { botManager } from '../integrations/discord/botManager.js';
import { startEscalationScheduler, stopEscalationScheduler } from '../modules/community/escalation.controller.js';
import { runScheduledAutoAnswer, stopAutoAnswerScheduler } from '../modules/ai/auto-answer.controller.js';
import { runScheduledFAQAudit, stopFAQAuditScheduler } from '../modules/faq/faq-audit.controller.js';
import { startDocumentWorker, stopDocumentWorker } from '../utils/jobs/documentQueue.js';
import { cronManager } from '../core/scheduler/cronManager.js';
import mongoose from 'mongoose';
import { jobQueue } from '../utils/http/jobQueue.js';

// Cron job handlers
import { runPromotionCycle } from '../modules/program/promotion.service.js';
import { runFreshnessCheck } from '../modules/faq/freshness.controller.js';
import { clusterAllActiveBatches } from '../utils/ai/categoryClusterer.js';
import { recomputePopularity } from '../modules/faq/public-faq.controller.js';
import { retryFailedMeetings } from '../modules/zoom/retry.service.js';
import { runPromotePopularDocumentInsights } from '../modules/knowledge/document-promotion.controller.js';
import { flushSearchLogs } from '../modules/search/search.controller.js';

const runRetention = async () => {
  try {
    const { cleanSearchLogs, cleanNotifications, cleanFreshReviewLogs, cleanModerationLogs, cleanAdminLogs } = await import('../scripts/retentionPolicy.js');
    await cleanSearchLogs();
    await cleanNotifications();
    await cleanFreshReviewLogs();
    await cleanModerationLogs();
    await cleanAdminLogs();
  } catch (e: unknown) {
    logger.error(`[retention] Policy execution failed: ${(e as Error).message}`);
  }
};

export async function startup(config: any): Promise<void> {
  // Ensure DB connection and migration
  try {
    await connectDB();
    await migrateZoomSettingsToSessions();
  } catch (e) {
    startupLog.error('startup DB connect / migrate failed', { error: (e as Error).message });
  }

  // Lazy-init the RegistrationConfig singleton
  try {
    const { ensureRegistrationConfig } = await import('../modules/program/registration-config.model.js');
    await ensureRegistrationConfig();
  } catch (e) {
    startupLog.warn(`[registrationConfig] ensure failed at startup: ${(e as Error).message}`);
  }

  // Start schedulers & bots
  startEscalationScheduler();
  runScheduledAutoAnswer().catch((err) => logger.error(`[autoAnswer] Startup: ${(err as Error).message}`));
  runScheduledFAQAudit().catch((err) => logger.error(`[faqAudit] Startup: ${(err as Error).message}`));

  void startBot().catch((err) => logger.error(`[bot] startup: ${(err as Error).message}`));
  void botManager.startAll().catch((err) => logger.error(`[botManager] startAll: ${(err as Error).message}`));

  // Register cron tasks
  cronManager.register({
    name: 'promotion-cycle',
    handler: runPromotionCycle,
    intervalMs: config.cron.promotionCycleIntervalMs,
    runOnStartup: true,
  });

  cronManager.register({
    name: 'freshness-check',
    handler: runFreshnessCheck,
    intervalMs: config.cron.freshnessCheckIntervalMs,
    runOnStartup: true,
  });

  cronManager.register({
    name: 'category-cluster',
    handler: clusterAllActiveBatches,
    intervalMs: config.cron.categoryClusterIntervalMs,
    runOnStartup: true,
    startupDelayMs: 15_000,
  });

  cronManager.register({
    name: 'popularity-recompute',
    handler: recomputePopularity,
    intervalMs: config.cron.popularityRecomputeIntervalMs,
    runOnStartup: true,
    startupDelayMs: 15_000,
  });

  cronManager.register({
    name: 'retention-policy',
    handler: runRetention,
    intervalMs: config.cron.retentionPolicyIntervalMs,
    runOnStartup: true,
  });

  cronManager.register({
    name: 'zoom-retry',
    handler: retryFailedMeetings,
    intervalMs: config.cron.zoomRetryIntervalMs,
    runOnStartup: false,
  });

  const documentWorkerStarted = startDocumentWorker();
  if (documentWorkerStarted) {
    cronManager.register({
      name: 'document-promotion',
      handler: runPromotePopularDocumentInsights,
      intervalMs: config.documents.autoPromote.intervalMs,
      runOnStartup: false,
    });
    logger.info(`[server] document pipeline online (worker + auto-promote every ${config.documents.autoPromote.intervalMs / 1000}s)`);
  } else {
    logger.info('[server] document pipeline offline — set REDIS_TCP_URL to enable');
  }

  // Start cron manager
  cronManager.startAll();
}

export async function stopAllSchedulers(): Promise<void> {
  // Stop cron intervals
  cronManager.stopAll();

  // Stop escalation scheduler
  stopEscalationScheduler();

  // Stop AI schedulers
  stopAutoAnswerScheduler();
  stopFAQAuditScheduler();

  // Stop Discord bots
  await stopBot();
  await botManager.stopAll();

  // Stop BullMQ workers
  await stopDocumentWorker();

  // Flush pending queues & buffered logs
  await jobQueue.flush(15_000);
  await flushSearchLogs();

  // Close MongoDB connection
  await mongoose.connection.close();
}
