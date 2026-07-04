/**
 * AdminSchedule.tsx — admin Schedule tab.
 *
 * Surfaces every automated process the backend runs (cron jobs +
 * legacy setInterval schedulers + service-lifecycle work + startup
 * one-shots). For each process:
 *   - Status (active / running / erroring / disabled)
 *   - Last run timestamp
 *   - Last error (if any)
 *   - Cadence (every X minutes / hours / days)
 *   - "Run now" button (when canTriggerManually is true)
 *
 * Auto-refreshes every 5s so the admin sees in-flight runs and
 * status changes without refreshing the page.
 */

import { useEffect, useState, useCallback } from 'react';
import adminApi from '../utils/adminApi';

interface ScheduledProcess {
  id: string;
  label: string;
  description: string;
  kind: 'cron' | 'setInterval' | 'service' | 'startup-only';
  owner: string;
  intervalMs: number;
  isActive: boolean;
  isRunning: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  errorCount: number;
  skipCount: number;
  canTriggerManually: boolean;
  meta?: Record<string, unknown>;
}

interface ScheduleResponse {
  processes: ScheduledProcess[];
  summary: {
    total: number;
    cron: number;
    active: number;
    erroring: number;
  };
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function formatInterval(ms: number): string {
  if (ms <= 0) return 'one-off';
  if (ms < 60_000) return `every ${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `every ${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `every ${Math.round(ms / 3_600_000)}h`;
  return `every ${Math.round(ms / 86_400_000)}d`;
}

function StatusDot({ p }: { p: ScheduledProcess }): React.ReactElement {
  if (p.isRunning) {
    return <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" title="running now" />;
  }
  if (p.lastError && p.errorCount > 0) {
    return <span className="inline-block w-2 h-2 rounded-full bg-red-400" title="last run errored" />;
  }
  if (!p.isActive) {
    return <span className="inline-block w-2 h-2 rounded-full bg-gray-400" title="not active" />;
  }
  return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" title="healthy" />;
}

function KindBadge({ kind }: { kind: ScheduledProcess['kind'] }): React.ReactElement {
  const styles: Record<ScheduledProcess['kind'], string> = {
    cron: 'bg-accent/10 text-accent border-accent/20',
    setInterval: 'bg-warning/10 text-warning border-warning/20',
    service: 'bg-success/10 text-success border-success/20',
    'startup-only': 'bg-mist text-ink-soft border-border',
  };
  const labels: Record<ScheduledProcess['kind'], string> = {
    cron: 'cron',
    setInterval: 'setInterval',
    service: 'service',
    'startup-only': 'startup',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${styles[kind]}`}>
      {labels[kind]}
    </span>
  );
}

export default function AdminSchedule(): React.ReactElement {
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'cron' | 'erroring' | 'running'>('all');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await adminApi.get<ScheduleResponse>('/admin/schedule');
      setData(res.data);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 5_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const trigger = useCallback(async (id: string) => {
    setTriggering(id);
    try {
      await adminApi.post(`/admin/schedule/${encodeURIComponent(id)}/trigger`);
      showToast(`Triggered ${id}`, 'success');
      void refresh();
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Trigger failed', 'error');
    } finally {
      setTriggering(null);
    }
  }, [refresh, showToast]);

  if (loading && !data) {
    return (
      <div className="space-y-4 max-w-5xl">
        <div className="h-8 w-48 bg-mist rounded animate-pulse" />
        <div className="h-96 admin-card-surface animate-pulse" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="admin-card-surface p-6">
        <p className="text-danger">Error loading schedule: {error}</p>
        <button type="button" onClick={refresh} className="mt-3 admin-btn-secondary px-3 py-1.5 text-xs">Retry</button>
      </div>
    );
  }

  const processes = data?.processes ?? [];
  const filtered = processes.filter((p) => {
    if (filter === 'cron' && p.kind !== 'cron') return false;
    if (filter === 'erroring' && p.errorCount === 0) return false;
    if (filter === 'running' && !p.isRunning) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.label.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-ink">Schedule</h1>
        <p className="text-sm text-ink-faint mt-1">
          Every automated process the backend runs — cron jobs, legacy schedulers,
          service-lifecycle work, and one-shot startup migrations. Refreshes every 5 seconds.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryStat label="Total" value={data?.summary.total ?? 0} accent="text-ink" />
        <SummaryStat label="Cron jobs" value={data?.summary.cron ?? 0} accent="text-accent" />
        <SummaryStat label="Active" value={data?.summary.active ?? 0} accent="text-emerald-400" />
        <SummaryStat label="Erroring" value={data?.summary.erroring ?? 0} accent="text-red-400" />
      </div>

      {/* Filters */}
      <div className="admin-card-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search by name or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="admin-input text-sm flex-1 min-w-[200px]"
          />
          <div className="flex gap-1.5 text-xs">
            {(['all', 'cron', 'erroring', 'running'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  filter === f ? 'bg-accent text-accent-text' : 'bg-mist text-ink-soft hover:bg-cream'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Process table */}
      <div className="admin-card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-mist/40 border-b border-border">
              <tr className="text-left">
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-ink-faint">Status</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-ink-faint">Process</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-ink-faint">Kind</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-ink-faint">Cadence</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-ink-faint">Last run</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-ink-faint">Errors</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-ink-faint text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink-faint text-sm">
                    No processes match the current filter.
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-mist/20 transition-colors">
                  <td className="px-4 py-3"><StatusDot p={p} /></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium text-ink">{p.label}</span>
                      <span className="text-[11px] text-ink-faint font-mono">{p.id}</span>
                      {p.description && (
                        <span className="text-xs text-ink-soft mt-0.5 max-w-md">{p.description}</span>
                      )}
                      {typeof p.meta?.featureFlag === 'string' && (
                        <span className="text-[10px] text-ink-faint mt-0.5">
                          gated by <span className="font-mono">{p.meta.featureFlag}</span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3"><KindBadge kind={p.kind} /></td>
                  <td className="px-4 py-3 text-ink-soft text-xs font-mono">
                    {formatInterval(p.intervalMs)}
                  </td>
                  <td className="px-4 py-3 text-ink-soft text-xs">
                    {p.lastRunAt ? formatRelative(p.lastRunAt) : 'never'}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {p.errorCount > 0 ? (
                      <div className="flex flex-col">
                        <span className="text-red-400 font-semibold">{p.errorCount} error{p.errorCount === 1 ? '' : 's'}</span>
                        {p.lastError && (
                          <span className="text-[10px] text-ink-faint max-w-xs truncate" title={p.lastError}>
                            {p.lastError}
                          </span>
                        )}
                      </div>
                    ) : p.skipCount > 0 ? (
                      <span className="text-ink-faint">{p.skipCount} skipped</span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.canTriggerManually ? (
                      <button
                        type="button"
                        onClick={() => trigger(p.id)}
                        disabled={triggering === p.id || p.isRunning}
                        className="admin-btn-secondary px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {triggering === p.id ? 'Running…' : p.isRunning ? 'In flight' : 'Run now'}
                      </button>
                    ) : (
                      <span className="text-[10px] text-ink-faint italic">
                        {p.kind === 'startup-only' ? 'runs at boot' : 'no trigger'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl text-sm shadow-lg ${
            toast.type === 'success' ? 'admin-toast-success' : 'admin-toast-error'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, accent }: { label: string; value: number; accent: string }): React.ReactElement {
  return (
    <div className="admin-card-surface p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent}`}>{value}</p>
    </div>
  );
}