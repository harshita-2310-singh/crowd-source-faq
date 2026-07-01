import { useEffect, useMemo, useRef, useState } from 'react';
import adminApi from '../utils/adminApi';
import { friendlyError } from '../../utils/api';
import Badge from '../components/common/Badge';

type AiAnswerStatus =
  | 'pending'
  | 'suggested'
  | 'approved'
  | 'rejected'
  | 'ask_human'
  | 'escalated';

interface RankedHit {
  source: 'faq' | 'kb' | 'community' | 'comments' | 'recent_activity';
  sourceId: string;
  question: string;
  answer: string;
  score: number;
  confidence: number;
  ageDays: number;
  rank: number;
  matchedOn?: string;
  batchId?: string;
  meta?: Record<string, unknown>;
}

interface AiContext {
  hits: RankedHit[];
  sources: { name: string; returned: number; weight: number }[];
  query: string;
  takenAt: string;
}

interface QueuedPost {
  _id: string;
  title: string;
  body?: string;
  status: string;
  aiAnswer?: string | null;
  aiAnswerConfidence?: number | null;
  aiAnswerStatus?: AiAnswerStatus | null;
  aiAnswerSource?: string | null;
  aiAnswerSuggestedAt?: string | null;
  aiAnswerAttempts?: number;
  tags?: string[];
  createdAt?: string;
  author?: { name?: string; email?: string };
  aiContext?: AiContext | null;
}

interface PaginatedResponse {
  items: QueuedPost[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

type TabKey = 'asked' | 'suggested' | 'all';

const PAGE_LIMIT = 10;

function apiStatusForTab(tab: TabKey): 'asked' | 'suggested' | 'all' {
  // Backend maps `asked` -> aiAnswerStatus === 'ask_human'
  return tab;
}

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

interface ActionButtonsProps {
  pending: boolean;
  onApprove: () => void;
  onApproveEdit: () => void;
  onReject: (reason: string) => void;
  onAskAgain: (extra: string) => void;
}

function ActionButtons({
  pending,
  onApprove,
  onApproveEdit,
  onReject,
  onAskAgain,
}: ActionButtonsProps) {
  const disabledAll = pending;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={onApprove}
        disabled={disabledAll}
        className="text-[11px] px-3 py-1.5 rounded-lg bg-success/10 border border-success/20 text-success hover:bg-success/20 transition-all disabled:opacity-50"
      >
        {pending ? 'Working…' : 'Approve'}
      </button>
      <button
        onClick={onApproveEdit}
        disabled={disabledAll}
        className="text-[11px] px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-all disabled:opacity-50"
      >
        Approve + Edit
      </button>
      <button
        onClick={() => {
          const reason = typeof window !== 'undefined'
            ? window.prompt('Optional rejection reason (1 line):', '') ?? ''
            : '';
          onReject(reason);
        }}
        disabled={disabledAll}
        className="text-[11px] px-3 py-1.5 rounded-lg bg-danger/10 border border-danger/20 text-danger hover:bg-danger/20 transition-all disabled:opacity-50"
      >
        Reject
      </button>
      <button
        onClick={() => {
          const extra = typeof window !== 'undefined'
            ? window.prompt('Optional extra context for the AI (1–2 sentences):', '') ?? ''
            : '';
          onAskAgain(extra);
        }}
        disabled={disabledAll}
        className="text-[11px] px-3 py-1.5 rounded-lg bg-warning/10 border border-warning/20 text-warning hover:bg-warning/20 transition-all disabled:opacity-50"
      >
        Ask AI Again
      </button>
    </div>
  );
}

interface DiffViewProps {
  aiDraft: string;
  edit: string;
}

/**
 * Side-by-side AI draft vs the admin's edit. We highlight lines that differ
 * via a simple character-level diff (no library): compare the two strings and
 * mark runs in the admin edit that don't appear in the AI draft.
 */
function DiffView({ aiDraft, edit }: DiffViewProps) {
  const aiLines = aiDraft.split('\n');
  const editLines = edit.split('\n');

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
      }}
    >
      <div className="bg-mist rounded-xl border border-border p-3">
        <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest mb-2">
          AI Draft
        </p>
        <pre className="text-xs text-ink-soft whitespace-pre-wrap font-mono leading-relaxed">
          {aiLines.length === 0 || (aiLines.length === 1 && aiLines[0] === '')
            ? '(empty)'
            : aiDraft}
        </pre>
      </div>
      <div className="bg-accent/5 rounded-xl border border-accent/30 p-3">
        <p className="text-[10px] font-semibold text-accent uppercase tracking-widest mb-2">
          Your Edit
        </p>
        <pre className="text-xs text-ink whitespace-pre-wrap font-mono leading-relaxed">
          {editLines.length === 0 || (editLines.length === 1 && editLines[0] === '')
            ? '(empty)'
            : edit}
        </pre>
        {/* Cheap diff hint: show which lines in the edit are not in the AI draft. */}
        {editLines
          .filter((l) => l.trim() && !aiDraft.includes(l))
          .slice(0, 3)
          .map((l, i) => (
            <p
              key={i}
              className="text-[10px] text-warning mt-1.5 italic"
              title="Not in the AI draft"
            >
              + {truncate(l, 120)}
            </p>
          ))}
      </div>
    </div>
  );
}

export default function AdminAutoAnswerQueue() {
  const [tab, setTab] = useState<TabKey>('suggested');
  const [page, setPage] = useState<number>(1);
  const [items, setItems] = useState<QueuedPost[]>([]);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastActionResult, setLastActionResult] = useState<string | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  // Per-post UI state (textarea contents, expanded source citations).
  const [expandedPosts, setExpandedPosts] = useState<Record<string, boolean>>({});
  const [adminReplyByPost, setAdminReplyByPost] = useState<Record<string, string>>({});
  const [expandedHitsByPost, setExpandedHitsByPost] = useState<Record<string, Record<number, boolean>>>({});

  // Counts for tab badges — fetched in parallel as count-only probes.
  const [tabCounts, setTabCounts] = useState<{ asked: number; suggested: number; all: number }>({
    asked: 0,
    suggested: 0,
    all: 0,
  });

  // Keep the URL ?status=&page= in sync so links are shareable (no router ref).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('status', tab);
    url.searchParams.set('page', String(page));
    window.history.replaceState(null, '', url.toString());
  }, [tab, page]);

  // Fetch just the totals for the three tabs (limit=1, read .total).
  // (counts inlined in effect, see below)

  // Helper to re-fetch the current page + counts (used after a successful
  // admin action so the queue reflects the new state).
  const refetchAllRef = useRef<() => Promise<void>>();
  refetchAllRef.current = async () => {
    await Promise.all([
      (async () => {
        try {
          const res = await adminApi.get<PaginatedResponse>(
            '/admin/auto-answer/queue/paginated',
            { params: { status: apiStatusForTab(tab), page, limit: PAGE_LIMIT } },
          );
          const data = res.data;
          setItems(data.items ?? []);
          setTotal(data.total ?? 0);
          setTotalPages(Math.max(1, data.pages ?? 1));
        } catch {
          /* keep last data on screen if refetch fails */
        }
      })(),
      (async () => {
        try {
          const [askedR, suggestedR, allR] = await Promise.all([
            adminApi.get<PaginatedResponse>(
              '/admin/auto-answer/queue/paginated',
              { params: { status: 'asked', page: 1, limit: 1 } },
            ),
            adminApi.get<PaginatedResponse>(
              '/admin/auto-answer/queue/paginated',
              { params: { status: 'suggested', page: 1, limit: 1 } },
            ),
            adminApi.get<PaginatedResponse>(
              '/admin/auto-answer/queue/paginated',
              { params: { status: 'all', page: 1, limit: 1 } },
            ),
          ]);
          setTabCounts({
            asked: askedR.data.total ?? 0,
            suggested: suggestedR.data.total ?? 0,
            all: allR.data.total ?? 0,
          });
        } catch {
          /* counts non-critical */
        }
      })(),
    ]);
  };
  const refetchAll = () => refetchAllRef.current?.() ?? Promise.resolve();

  // Initial + tab/page change: fetch this page + refresh tab counts.
  // We still refresh counts whenever the active tab or page changes so the
  // badges stay current after pagination actions.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await adminApi.get<PaginatedResponse>(
          '/admin/auto-answer/queue/paginated',
          { params: { status: apiStatusForTab(tab), page, limit: PAGE_LIMIT } },
        );
        if (cancelled) return;
        const data = res.data;
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setTotalPages(Math.max(1, data.pages ?? 1));
        setPage(data.page ?? page);
      } catch (e) {
        if (cancelled) return;
        setActionError(friendlyError(e, 'Failed to load queue'));
        setItems([]);
        setTotal(0);
        setTotalPages(1);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Counts (best-effort; never block page render on these).
    (async () => {
      try {
        const [askedR, suggestedR, allR] = await Promise.all([
          adminApi.get<PaginatedResponse>(
            '/admin/auto-answer/queue/paginated',
            { params: { status: 'asked', page: 1, limit: 1 } },
          ),
          adminApi.get<PaginatedResponse>(
            '/admin/auto-answer/queue/paginated',
            { params: { status: 'suggested', page: 1, limit: 1 } },
          ),
          adminApi.get<PaginatedResponse>(
            '/admin/auto-answer/queue/paginated',
            { params: { status: 'all', page: 1, limit: 1 } },
          ),
        ]);
        if (cancelled) return;
        setTabCounts({
          asked: askedR.data.total ?? 0,
          suggested: suggestedR.data.total ?? 0,
          all: allR.data.total ?? 0,
        });
      } catch {
        /* counts are non-critical */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab, page]);

  const runAction = async (
    postId: string,
    request: () => Promise<unknown>,
    successLabel: string,
  ) => {
    setActionError(null);
    setActionLoading(postId);
    try {
      await request();
      setLastActionResult(successLabel);
      await refetchAll();
    } catch (e) {
      setActionError(friendlyError(e, 'Action failed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = (post: QueuedPost) =>
    runAction(post._id, () => adminApi.post(`/admin/auto-answer/${post._id}/approve`, {}), 'Approved');

  const handleApproveEdit = (post: QueuedPost) => {
    const answer = (adminReplyByPost[post._id] ?? '').trim();
    if (!answer) {
      setActionError('Type your answer in the admin reply box before approving with edit.');
      return;
    }
    runAction(
      post._id,
      () => adminApi.post(`/admin/auto-answer/${post._id}/approve-edit`, { answer }),
      'Approved with edit',
    );
  };

  const handleReject = (post: QueuedPost, reason: string) =>
    runAction(
      post._id,
      () => adminApi.post(`/admin/auto-answer/${post._id}/reject`, { reason: reason || undefined }),
      'Rejected',
    );

  const handleAskAgain = (post: QueuedPost, extra: string) =>
    runAction(
      post._id,
      () =>
        adminApi.post(`/admin/auto-answer/${post._id}/ask-ai-again`, {
          extraContext: extra || undefined,
        }),
      'Asked AI again',
    );

  const handleRunAutoAnswer = async () => {
    setRunLoading(true);
    setRunResult(null);
    try {
      const r = await adminApi.post('/admin/community/auto-answer');
      setRunResult(
        `${r.data.message} — processed: ${r.data.processed}, auto-approved: ${r.data.auto_approved}, suggested: ${r.data.suggested}, escalated: ${r.data.escalated}, errors: ${r.data.errors}`,
      );
      await refetchAll();
    } catch (e) {
      setRunResult(`Error: ${friendlyError(e, 'Run failed')}`);
    } finally {
      setRunLoading(false);
    }
  };

  const handleDryRun = async () => {
    setRunLoading(true);
    setRunResult(null);
    try {
      const r = await adminApi.get('/admin/community/auto-answer', { params: { dry_run: 'true' } });
      setRunResult(`Dry run: would process ${r.data.would_process} posts`);
    } catch (e) {
      setRunResult(`Error: ${friendlyError(e, 'Dry run failed')}`);
    } finally {
      setRunLoading(false);
    }
  };

  const tabBar: { key: TabKey; label: string; count: number }[] = useMemo(
    () => [
      { key: 'asked', label: 'Asked', count: tabCounts.asked },
      { key: 'suggested', label: 'Suggested', count: tabCounts.suggested },
      { key: 'all', label: 'All', count: tabCounts.all },
    ],
    [tabCounts],
  );

  const setAdminReply = (postId: string, value: string) =>
    setAdminReplyByPost((prev) => ({ ...prev, [postId]: value }));

  const togglePostExpanded = (postId: string) =>
    setExpandedPosts((prev) => ({ ...prev, [postId]: !prev[postId] }));

  const toggleHitExpanded = (postId: string, rank: number) =>
    setExpandedHitsByPost((prev) => ({
      ...prev,
      [postId]: { ...(prev[postId] ?? {}), [rank]: !(prev[postId]?.[rank] ?? false) },
    }));

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold text-ink">AI Auto-Answer Queue</h1>
          <p className="text-xs text-ink-faint mt-0.5">
            Review suggested answers, ask AI again, or escalate to a human moderator
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDryRun}
            disabled={runLoading}
            className="text-xs px-3.5 py-1.5 rounded-lg border border-border text-ink-soft hover:text-ink hover:bg-mist transition-all disabled:opacity-50"
          >
            Dry Run
          </button>
          <button
            onClick={handleRunAutoAnswer}
            disabled={runLoading}
            className="text-xs px-3.5 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-all disabled:opacity-50"
          >
            {runLoading ? 'Running…' : 'Run Now'}
          </button>
        </div>
      </div>

      {/* Manual-run result banner */}
      {runResult && (
        <div
          className={`text-xs px-4 py-3 rounded-xl border ${
            runResult.startsWith('Error')
              ? 'bg-danger/5 border-danger/20 text-danger'
              : 'bg-card border-border text-ink'
          }`}
        >
          {runResult}
        </div>
      )}

      {/* Action error banner */}
      {actionError && (
        <div className="text-xs px-4 py-3 rounded-xl bg-danger/5 border border-danger/20 text-danger">
          {actionError}
        </div>
      )}

      {/* Last action success banner */}
      {lastActionResult && (
        <div className="text-xs px-4 py-3 rounded-xl bg-success/5 border border-success/20 text-success">
          {lastActionResult}
        </div>
      )}

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Auto-answer queue filter"
        className="flex items-center gap-1"
      >
        {tabBar.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => {
                setTab(t.key);
                setPage(1);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                active
                  ? 'bg-accent/10 border-accent/20 text-accent'
                  : 'bg-card border-border text-ink-soft hover:text-ink hover:bg-mist'
              }`}
            >
              {t.label}{' '}
              <span
                className={`ml-1 text-[10px] ${
                  active ? 'text-accent/80' : 'text-ink-faint'
                }`}
              >
                ({t.count})
              </span>
            </button>
          );
        })}
      </div>

      {/* Queue */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-card border border-border rounded-xl p-4 animate-pulse"
            >
              <div className="h-4 bg-mist rounded w-3/4 mb-2" />
              <div className="h-3 bg-mist rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card border border-border rounded-xl px-6 py-12 text-center">
          <p className="text-sm text-ink-faint">
            No posts in this queue. All caught up 🎉
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((post) => {
            const postPending = actionLoading === post._id;
            const isOpen = !!expandedPosts[post._id];
            const editValue = adminReplyByPost[post._id] ?? '';
            const hasAiDraft = post.aiAnswerStatus === 'suggested' && !!post.aiAnswer;
            return (
              <div
                key={post._id}
                className="bg-card border border-border rounded-xl overflow-hidden"
              >
                {/* Header */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <button
                      type="button"
                      onClick={() => togglePostExpanded(post._id)}
                      className="flex-1 min-w-0 text-left"
                      aria-expanded={isOpen}
                    >
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="text-sm font-semibold text-ink">
                          {post.title}
                        </h3>
                        <Badge
                          status={
                            post.aiAnswerStatus === 'approved'
                              ? 'approved'
                              : post.aiAnswerStatus === 'rejected'
                              ? 'rejected'
                              : post.aiAnswerStatus === 'ask_human' ||
                                  post.aiAnswerStatus === 'escalated' ||
                                  post.aiAnswerStatus === 'suggested' ||
                                  post.aiAnswerStatus === 'pending'
                              ? 'pending'
                              : 'default'
                          }
                          label={post.aiAnswerStatus ?? 'pending'}
                          showDot={false}
                        />
                        {post.aiAnswerConfidence != null && (
                          <span
                            className={`text-[10px] font-medium ${
                              post.aiAnswerConfidence >= 0.85
                                ? 'text-success'
                                : 'text-warning'
                            }`}
                          >
                            {Math.round(post.aiAnswerConfidence * 100)}% conf
                          </span>
                        )}
                        {typeof post.aiAnswerAttempts === 'number' &&
                          post.aiAnswerAttempts > 0 && (
                            <span className="text-[10px] text-ink-faint">
                              attempts: {post.aiAnswerAttempts}
                            </span>
                          )}
                      </div>
                      <p className="text-xs text-ink-faint line-clamp-2 text-left">
                        {post.body}
                      </p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="text-[10px] text-ink-faint">
                          by {post.author?.name ?? 'Unknown'}
                        </span>
                        {post.createdAt && (
                          <span className="text-[10px] text-ink-faint">
                            {formatDate(post.createdAt)}
                          </span>
                        )}
                        {post.aiAnswerSource && (
                          <span className="text-[10px] text-ink-faint">
                            source: {post.aiAnswerSource}
                          </span>
                        )}
                        <span className="text-[10px] text-ink-faint">
                          {isOpen ? '▾ hide actions' : '▸ show actions'}
                        </span>
                      </div>
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
                    {/* AI draft answer */}
                    {hasAiDraft && (
                      <div className="bg-mist rounded-xl p-4 border border-border">
                        <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest mb-2">
                          AI Suggested Answer
                        </p>
                        <pre className="text-sm text-ink/80 leading-relaxed whitespace-pre-wrap font-mono">
                          {post.aiAnswer}
                        </pre>
                        {post.aiAnswerConfidence != null && (
                          <p className="text-[10px] text-ink-faint mt-2">
                            Confidence: {Math.round(post.aiAnswerConfidence * 100)}%
                            {post.aiAnswerSource ? ` · ${post.aiAnswerSource}` : ''}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Source citations */}
                    {post.aiContext?.hits && post.aiContext.hits.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest mb-2">
                          Source Citations ({post.aiContext.hits.length})
                        </p>
                        <div className="space-y-2">
                          {post.aiContext.hits.slice(0, 3).map((hit) => {
                            const open = !!expandedHitsByPost[post._id]?.[hit.rank];
                            return (
                              <button
                                key={`${hit.source}-${hit.rank}-${hit.sourceId}`}
                                type="button"
                                onClick={() => toggleHitExpanded(post._id, hit.rank)}
                                className="w-full text-left rounded-xl border border-border bg-card hover:bg-mist transition-colors"
                              >
                                <div className="p-3">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] font-mono font-semibold text-accent">
                                      {hit.source}:{truncate(hit.sourceId, 16)}
                                    </span>
                                    <span className="text-[10px] text-ink-faint">
                                      rank #{hit.rank} · score{' '}
                                      {hit.score.toFixed(2)} · conf{' '}
                                      {(hit.confidence * 100).toFixed(0)}% · age{' '}
                                      {hit.ageDays}d
                                    </span>
                                    <span className="ml-auto text-[10px] text-ink-faint">
                                      {open ? '▾' : '▸'}
                                    </span>
                                  </div>
                                  <p className="text-xs text-ink mt-1 line-clamp-2 text-left">
                                    {hit.question}
                                  </p>
                                  {open && (
                                    <div className="mt-2 text-xs text-ink-soft leading-relaxed text-left">
                                      <p className="font-semibold text-ink mb-1">
                                        Answer
                                      </p>
                                      <p className="whitespace-pre-wrap">
                                        {hit.answer}
                                      </p>
                                      {hit.matchedOn && (
                                        <p className="text-[10px] text-ink-faint mt-2">
                                          Matched on: {hit.matchedOn}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        {post.aiContext.query && (
                          <p className="text-[10px] text-ink-faint mt-2">
                            Retrieval query:{' '}
                            <span className="font-mono">
                              {truncate(post.aiContext.query, 140)}
                            </span>
                          </p>
                        )}
                      </div>
                    )}

                    {/* Diff view — only when editing an AI draft */}
                    {hasAiDraft && editValue.trim().length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest mb-2">
                          Preview — AI vs Your edit
                        </p>
                        <DiffView
                          aiDraft={post.aiAnswer ?? ''}
                          edit={editValue}
                        />
                      </div>
                    )}

                    {/* Admin reply textarea */}
                    <div>
                      <label
                        htmlFor={`reply-${post._id}`}
                        className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest block mb-1.5"
                      >
                        Admin reply{' '}
                        <span className="lowercase font-normal text-ink-faint">
                          (required for Approve + Edit)
                        </span>
                      </label>
                      <textarea
                        id={`reply-${post._id}`}
                        value={editValue}
                        onChange={(e) => setAdminReply(post._id, e.target.value)}
                        placeholder="Replace the AI draft with your own answer, or leave blank to approve as-is…"
                        rows={4}
                        className="w-full rounded-xl border border-border bg-mist px-3 py-2 text-xs text-ink placeholder-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/25 resize-y"
                      />
                    </div>

                    {/* Action buttons */}
                    <ActionButtons
                      pending={postPending}
                      onApprove={() => handleApprove(post)}
                      onApproveEdit={() => handleApproveEdit(post)}
                      onReject={(reason) => handleReject(post, reason)}
                      onAskAgain={(extra) => handleAskAgain(post, extra)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && items.length > 0 && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="text-xs px-3 py-1.5 rounded-lg border border-border bg-card text-ink-soft hover:text-ink hover:bg-mist transition-all disabled:opacity-40"
          >
            ← Prev
          </button>
          <p className="text-[11px] text-ink-soft">
            Page {page} of {totalPages}{' '}
            <span className="text-ink-faint">({total} total)</span>
          </p>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="text-xs px-3 py-1.5 rounded-lg border border-border bg-card text-ink-soft hover:text-ink hover:bg-mist transition-all disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
