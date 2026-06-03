# Codebase Issues Audit

> Generated from full-tree review on 2026-06-03. Severity legend: 🔴 high · 🟡 medium · 🟢 low.

## Backend

### 🔴 B1 — Manual transcript upload missing
**Where:** No endpoint exists to manually upload a `.vtt` / `.txt` file. The only path is the Zoom webhook + OAuth. If Zoom's webhook fails (network, rate-limit, Zoom-side outage), the data is lost unless the admin re-requests it from Zoom. Spec asks for a robustness fallback.
**Fix:** Add `POST /api/zoom/upload-transcript` accepting `.vtt` or `.txt` (auth: admin). Runs the same pipeline (parse → extract → embed → store). Wire a UI dropzone under the Zoom card on AccountPage.

### 🟡 B2 — VTT speaker detection is fragile
**Where:** `backend/utils/vttParser.ts:102`
```
if (currentSpeaker === '' && /^[A-Za-z]/.test(line) && !line.endsWith('.')) {
```
A short declarative line that *isn't* a speaker (e.g. "Yes", "I think") gets misclassified as a speaker. Worse, multi-line speakers ("First\nLast Name") would treat the first line as speaker and the second as text.
**Fix:** Tighten the heuristic: speaker lines should be ≤4 words AND start with a capital letter AND contain no period/comma inside. Multi-line: allow up to 2 short lines before a long line.

### 🟡 B3 — `extractSnippet()` ignores timestamps
**Where:** `backend/utils/vttParser.ts:121` — comment says "We don't have per-segment timestamps here" but the segment is followed by a timestamp on the previous line; the function could store the seconds offset.
**Fix:** Have `parseVTTWithSpeakers` return `TranscriptSegment & { startSec: number }` so snippets can be time-accurate.

### 🟡 B4 — `parseVTT()` re-parses via `parseVTTWithSpeakers()` (double work)
**Where:** `backend/utils/vttParser.ts:44`
**Fix:** Cached parse — keep one result. (Minor; ~3ms saved per Zoom meeting. Skip if low priority.)

### 🟡 B5 — `convertInsightToFAQ` doesn't carry speaker/snippet metadata
**Where:** `backend/controllers/zoomController.ts:355` — the new FAQ loses the transcript context that the ZoomInsight had. Admin can't trace back which meeting/section this came from.
**Fix:** Pass `sourceMeetingId`, `sourceMeetingTopic`, and the AI confidence score through; the FAQ model already supports these fields.

### 🟢 B6 — VTT parser has dead code
**Where:** `backend/utils/vttParser.ts:60-62` — the initial `while (!lines[i].includes('-->'))` skip is reset to 0 immediately. Inefficient, not buggy.
**Fix:** Delete the dead loop.

### 🟢 B7 — Empty-transcript threshold is 50 chars
**Where:** `backend/utils/vttParser.ts:138` — a 50-char transcript will be silently dropped. Some short Q&A sessions may be valid below this threshold.
**Fix:** Lower to 30, but log a warning when <50 instead of dropping.

### 🟢 B8 — `zoomExtractor.ts` doesn't validate that topic is non-empty
**Where:** If `meetingTopic` is empty string, the LLM prompt becomes "Meeting topic: \n\nTranscript: …" which can confuse smaller models.
**Fix:** Default to "Untitled meeting" when blank.

## Frontend

### 🟡 F1 — AccountPage has no manual upload UI
**Where:** `frontend/src/pages/AccountPage.tsx:479-517` — Zoom card shows only Connect/Disconnect. No manual upload.
**Fix:** Add a file input + dropzone below the Connect button. Show processing state.

### 🟡 F2 — No client-side VTT validation
**Where:** Future: when the upload UI is added, the client should reject files >5MB or wrong MIME type before hitting the server.
**Fix:** Wire into the upload UI.

### 🟢 F3 — Zoom status doesn't show "last sync"
**Where:** `zoomStatus.connectedAt` exists but no UI consumes it on the Account page.
**Fix:** Show "Last sync: <relative time>" if any meetings have been processed.

## Data Integrity

### 🟡 D1 — ZoomInsight documents have no embeddings
**Where:** `yaksha_zoom_insights` collection — when admins approve, the resulting FAQ gets an embedding (via `convertInsightToFAQ`), but the raw insight has no vector. Approved-but-not-promoted insights are invisible to semantic search.
**Fix:** Backfill embeddings on insights with `status: 'approved' && embedding: null` (low priority; not in spec).

### 🟢 D2 — Old zoom insights exist with `confidence_score = 0` and no `transcript_snippet`
**Where:** `yaksha_zoom_insights` — pre-2026 data has null snippet fields. UI shows "—" for them.
**Fix:** Acceptable; no action needed.

## Infra / Robustness

### 🔴 I1 — Single AI extraction in Zoom pipeline
**Where:** `backend/controllers/zoomController.ts:188-192` — `processZoomMeetingForKnowledge` runs in parallel with `extractInsightsFromTranscript` but if the AI call fails, no retry, no dead-letter queue.
**Fix:** Add a dead-letter collection (`yaksha_zoom_processing_failures`) for the retry job. (Defer; no retry infra exists yet.)

### 🟡 I2 — Zoom webhook doesn't verify request signature
**Where:** `backend/routes/zoom.ts:40` — Zoom sends `x-zm-signature` header (HMAC-SHA256) for webhook validation. Code didn't check it.
**Fix:** `verifyZoomSignature()` checks `x-zm-signature` against `ZOOM_WEBHOOK_SECRET_TOKEN`; skips if env not set (dev mode). ✅ Done.

### 🟡 I4 — AI auth headers missing `Bearer` prefix for non-Anthropic providers
**Where:** `backend/utils/zoomExtractor.ts`, `backend/services/knowledgeBase.ts`, `backend/services/aiClient.ts`, `backend/services/rag.ts`, `backend/utils/duplicateDetector.ts` — all sent raw API key as the auth header value (e.g. `Authorization: sk_live_xxx`) instead of `Authorization: Bearer sk_live_xxx`. The proxy (`samagama.in`) requires the `Bearer` prefix, causing all AI calls to return 401. `chatWithProvider` in `aiProvider.ts` was already correct; the other 5 call sites inherited the bug.
**Fix:** All call sites now construct `authValue = provider === 'anthropic' ? apiKey : \`Bearer ${apiKey}\`` before assigning to the auth header. ✅ Done.

### 🟢 I3 — No rate limit on `/api/zoom/webhook`
**Where:** Same as above. Could be flooded.
**Fix:** Add a `webhookLimiter` similar to `suggestLimiter`. (Low priority if signature is verified.)

---

---

## Fixes Applied (2026-06-03 pass)

| # | Action | Status |
|---|--------|--------|
| B1 | `POST /api/zoom/upload-transcript` (multipart .vtt/.txt + rawText JSON body) + AccountPage dropzone | ✅ Done |
| B2 | Speaker heuristic: `isSpeakerLabel()` checks word count ≤4, capital start, no internal punctuation, next line is longer | ✅ Done |
| B3 | `TranscriptSegment` now carries `startSec`; `extractSnippet` uses it for timed excerpts | ✅ Done |
| B5 | `convertInsightToFAQ` sets `sourceMeetingId` / `sourceMeetingTopic` / `confidence_score` on promoted FAQ | ✅ Done |
| B6 | Dead `while` loop removed from `parseVTTWithSpeakers` | ✅ Done |
| B7 | `isEmptyTranscript` returns `{ empty, warning }`; below 50 chars logs warn but still passes | ✅ Done |
| B8 | Empty `meetingTopic` defaults to "Untitled meeting" before LLM call | ✅ Done |
| F1 | Manual upload dropzone on AccountPage (admin/moderator sees it always; connected users see it too) | ✅ Done |
| I2 | `verifyZoomSignature()` checks `x-zm-signature` HMAC-SHA256 against `ZOOM_WEBHOOK_SECRET_TOKEN`; skips if env not set (dev mode) | ✅ Done |

Backlog (not touched): B4, D1, D2, I1, I3, F2, F3.
