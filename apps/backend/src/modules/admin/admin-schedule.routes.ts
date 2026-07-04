/**
 * admin-schedule.routes.ts — admin Schedule tab endpoints.
 *
 *   GET    /api/admin/schedule           — list all processes
 *   GET    /api/admin/schedule/:id      — single process detail
 *   POST   /api/admin/schedule/:id/trigger — fire once on demand
 */
import { Router } from 'express';
import { listScheduledProcesses, getScheduledProcess, triggerScheduledProcess } from './admin-schedule.controller.js';

const router = Router();

router.get('/', listScheduledProcesses);
router.get('/:id', getScheduledProcess);
router.post('/:id/trigger', triggerScheduledProcess);

export default router;