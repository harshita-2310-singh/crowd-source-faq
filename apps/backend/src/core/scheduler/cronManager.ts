/**
 * cronManager.ts — central registry for periodic jobs.
 *
 * Phase 3 (auto-answer loop): added a per-job concurrency guard so a
 * slow tick cannot overlap the next tick. The fix mirrors the
 * atomic-write lesson from commit 60c1af0 (findOneAndUpdate over a
 * shared `running` Set) — if a job is already running, the new tick
 * is dropped with a warning instead of stacking a parallel run.
 *
 * Phase 7 R17: introspection API. The admin Schedule tab needs to
 * surface every registered job's last-run status, last error, and
 * offer a "Run now" button that triggers a single execution through
 * the same concurrency guard the cron tick uses.
 *
 * Backwards compatible: the public API (register / startAll /
 * stopAll) is unchanged. New methods are additive.
 */
import { logger } from '../../utils/http/logger.js';

export interface CronJob {
  name: string;
  handler: () => Promise<unknown>;
  intervalMs: number;
  runOnStartup?: boolean;
  startupDelayMs?: number;
}

/** Lightweight stats the admin UI consumes. Persisted in-memory only. */
export interface CronJobStats {
  name: string;
  intervalMs: number;
  runOnStartup: boolean;
  startupDelayMs?: number;
  /** Whether the interval timer is currently scheduled. */
  isScheduled: boolean;
  /** True while a handler invocation is in flight. */
  isRunning: boolean;
  /** Last successful run completion (or null if never run). */
  lastRunAt: Date | null;
  /** Last error message (or null if never errored). */
  lastError: string | null;
  /** Last error timestamp. */
  lastErrorAt: Date | null;
  /** Number of times this job has been skipped due to the concurrency lock. */
  skipCount: number;
  /** Number of times this job has errored. */
  errorCount: number;
}

interface JobStatsInternal extends CronJobStats {
  handler: () => Promise<unknown>;
}

export class CronManager {
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private jobs: CronJob[] = [];
  // Per-job concurrency lock. A job name is added while its handler
  // is in-flight; the next tick checks this Set before invoking.
  private running: Set<string> = new Set();
  // Stats keyed by job name.
  private stats: Map<string, JobStatsInternal> = new Map();

  register(job: CronJob): void {
    this.jobs.push(job);
    this.stats.set(job.name, {
      name: job.name,
      intervalMs: job.intervalMs,
      runOnStartup: job.runOnStartup ?? false,
      startupDelayMs: job.startupDelayMs,
      isScheduled: false,
      isRunning: false,
      lastRunAt: null,
      lastError: null,
      lastErrorAt: null,
      skipCount: 0,
      errorCount: 0,
      handler: job.handler,
    });
  }

  /**
   * Wraps a job's handler with the concurrency lock. Returns true if
   * the work ran, false if it was skipped because the job was
   * already in flight.
   */
  private async runWithLock(job: CronJob): Promise<boolean> {
    if (this.running.has(job.name)) {
      logger.warn(`[cronManager] job "${job.name}" still running, skipping tick`);
      const s = this.stats.get(job.name);
      if (s) s.skipCount++;
      return false;
    }
    this.running.add(job.name);
    const s = this.stats.get(job.name);
    if (s) s.isRunning = true;
    try {
      await job.handler();
      if (s) {
        s.lastRunAt = new Date();
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      logger.error(`[cronManager] Job "${job.name}" failed: ${msg}`);
      if (s) {
        s.lastError = msg;
        s.lastErrorAt = new Date();
        s.errorCount++;
      }
    } finally {
      this.running.delete(job.name);
      if (s) s.isRunning = false;
    }
    return true;
  }

  startAll(): void {
    for (const job of this.jobs) {
      // Setup the recurring interval — guarded by runWithLock so a
      // slow tick can never collide with the next one.
      const interval = setInterval(() => {
        void this.runWithLock(job);
      }, job.intervalMs);
      this.intervals.set(job.name, interval);

      const s = this.stats.get(job.name);
      if (s) s.isScheduled = true;

      // Startup execution if required — same guard applied.
      if (job.runOnStartup) {
        if (job.startupDelayMs) {
          setTimeout(() => {
            void this.runWithLock(job);
          }, job.startupDelayMs);
        } else {
          // Run immediately (asynchronously, fire-and-forget)
          void this.runWithLock(job);
        }
      }
    }
  }

  stopAll(): void {
    for (const [name, interval] of this.intervals.entries()) {
      clearInterval(interval);
      const s = this.stats.get(name);
      if (s) s.isScheduled = false;
    }
    this.intervals.clear();
    logger.info('[cronManager] All cron intervals cleared.');
  }

  // ─── Introspection API (Phase 7 R17) ───────────────────────────────────

  /**
   * Return a snapshot of every registered job's stats. The handler
   * function itself is stripped from the public payload.
   */
  listJobs(): CronJobStats[] {
    return Array.from(this.stats.values()).map((s) => {
      // Destructure to omit the handler from the public payload.
      const { handler: _handler, ...publicStats } = s;
      void _handler;
      return publicStats;
    });
  }

  /** Stats for a single job, or null if not registered. */
  getJob(name: string): CronJobStats | null {
    const s = this.stats.get(name);
    if (!s) return null;
    const { handler: _handler, ...publicStats } = s;
    void _handler;
    return publicStats;
  }

  /**
   * Trigger a single out-of-band execution of a registered job.
   * Uses the same concurrency lock as the cron tick, so an admin
   * "Run now" can't collide with an in-flight scheduled run.
   * Returns true if the job started, false if it's already running
   * or the name is unknown.
   */
  triggerOnce(name: string): boolean {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) return false;
    if (this.running.has(name)) {
      logger.warn(`[cronManager] triggerOnce("${name}") skipped — job already running`);
      return false;
    }
    void this.runWithLock(job);
    return true;
  }
}

export const cronManager = new CronManager();