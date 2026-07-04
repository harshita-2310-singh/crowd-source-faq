/**
 * admin-schedule.controller.ts — read-only + trigger endpoints for the
 * admin Schedule tab.
 *
 * Lists every registered automated process (cronManager jobs +
 * ad-hoc trackers registered with processRegistry), with per-job
 * stats: last run, last error, in-flight flag, cadence.
 *
 * POST /:id/trigger fires a cronManager job once. Non-cron jobs and
 * trigger-disabled jobs return 400.
 */

import type { Request, Response } from 'express';
import { cronManager } from '../../core/scheduler/cronManager.js';
import { processRegistry, PROCESS_METADATA, type ScheduledProcess } from '../../core/scheduler/processRegistry.js';

/** Coerce req.params.id (which is string | string[]) into a clean string. */
function paramId(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0]! : v;
}

/** GET /api/admin/schedule — list every process with stats. */
export function listScheduledProcesses(_req: Request, res: Response): void {
  const cronJobs = cronManager.listJobs();
  const processes = processRegistry.listAll(cronJobs, PROCESS_METADATA);
  res.json({
    processes,
    summary: {
      total: processes.length,
      cron: processes.filter((p) => p.kind === 'cron').length,
      active: processes.filter((p) => p.isActive).length,
      erroring: processes.filter((p) => (p.errorCount ?? 0) > 0).length,
    },
  });
}

/** GET /api/admin/schedule/:id — single process detail. */
export function getScheduledProcess(req: Request, res: Response): void {
  const id = paramId(req, 'id');
  // First check the cronManager
  const cronJob = cronManager.getJob(id);
  if (cronJob) {
    const meta = PROCESS_METADATA.find((m) => m.id === id);
    const process: ScheduledProcess = {
      id: cronJob.name,
      label: meta?.label ?? cronJob.name,
      description: meta?.description ?? '',
      kind: meta?.kind ?? 'cron',
      owner: meta?.owner ?? 'unknown',
      intervalMs: cronJob.intervalMs,
      isActive: cronJob.isScheduled,
      isRunning: cronJob.isRunning,
      lastRunAt: cronJob.lastRunAt,
      lastError: cronJob.lastError,
      lastErrorAt: cronJob.lastErrorAt,
      errorCount: cronJob.errorCount,
      skipCount: cronJob.skipCount,
      canTriggerManually: meta?.canTriggerManually ?? true,
      meta: meta?.meta,
    };
    res.json(process);
    return;
  }
  // Fallback: processRegistry entry
  const all = processRegistry.listAll(cronManager.listJobs(), PROCESS_METADATA);
  const found = all.find((p) => p.id === id);
  if (found) {
    res.json(found);
    return;
  }
  res.status(404).json({ message: `No process found with id "${id}"` });
}

/** POST /api/admin/schedule/:id/trigger — fire once on demand. */
export function triggerScheduledProcess(req: Request, res: Response): void {
  const id = paramId(req, 'id');
  // Cron job path
  if (cronManager.getJob(id)) {
    const meta = PROCESS_METADATA.find((m) => m.id === id);
    if (meta && meta.canTriggerManually === false) {
      res.status(400).json({ message: `Process "${id}" cannot be triggered manually (e.g. feature-flag-gated or too expensive)` });
      return;
    }
    const ok = cronManager.triggerOnce(id);
    if (!ok) {
      res.status(409).json({ message: `Process "${id}" is already running` });
      return;
    }
    res.json({ ok: true, message: `Triggered "${id}"` });
    return;
  }
  // processRegistry path
  const meta = PROCESS_METADATA.find((m) => m.id === id);
  if (!meta) {
    res.status(404).json({ message: `No process found with id "${id}"` });
    return;
  }
  if (meta.canTriggerManually === false) {
    res.status(400).json({ message: `Process "${id}" cannot be triggered manually` });
    return;
  }
  const ok = processRegistry.trigger(id);
  if (!ok) {
    res.status(409).json({ message: `Process "${id}" is already running or has no trigger handle` });
    return;
  }
  res.json({ ok: true, message: `Triggered "${id}"` });
}