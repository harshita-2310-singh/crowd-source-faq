/**
 * embeddings.ts — semantic embedding pipeline.
 *
 * v1.68 — Model swap: Xenova/multi-qa-mpnet-base-dot-v1
 * (768-dim, 110M params) → mixedbread-ai/mxbai-embed-large-v1
 * (1024-dim, 335M params). MTEB score 64.68 vs the old model's
 * lower MTEB; should fix the "FAQ search returns nothing useful"
 * complaint.
 *
 * v1.68 (HF API mode) — When HUGGINGFACE_API_KEY is set, route
 * all embedding calls through the HF Inference API at
 * https://router.huggingface.co/hf-inference/models/<model>.
 * No 1.2GB ONNX download, no in-process model load, just a
 * network call. When unset, fall back to running the model
 * in-process via @huggingface/transformers (the maintained
 * successor to @xenova/transformers).
 *
 * Important: mxbai wants a retrieval-specific prompt for QUERIES
 * ("Represent this sentence for searching relevant passages: ").
 * Documents (FAQs, posts) embed as-is, no prompt. Use
 * generateQueryEmbedding() for queries and generateEmbedding()
 * for documents.
 *
 * IMPORTANT: if you swap models again, you MUST:
 *   1. Update MODEL_SLUG below
 *   2. Update EMBEDDING_DIM below
 *   3. Run `npm run backfill:embeddings` to regenerate all stored
 *      vectors (old + new dims don't compose in the same Atlas
 *      index)
 *   4. Update the `numDimensions` value in the Atlas vector
 *      search index (recreate the index — Atlas doesn't allow
 *      in-place dim change)
 */
import {
  pipeline,
  FeatureExtractionPipeline,
  env as transformersEnv,
} from '@huggingface/transformers';
import { logger } from '../http/logger.js';

export const MODEL_SLUG = 'mixedbread-ai/mxbai-embed-large-v1';
export const EMBEDDING_DIM = 1024;
/** Retrieval prompt prepended to search queries. Don't add to documents. */
export const QUERY_PROMPT = 'Represent this sentence for searching relevant passages: ';

// ── HF Inference API path ────────────────────────────────────────────
// v1.68.1 — Switched from the legacy `api-inference.huggingface.co`
// subdomain to the new `router.huggingface.co/hf-inference/`
// path. The legacy subdomain has been unresolvable on some
// corporate / VPN DNS setups (ENOTFOUND), which silently
// broke every embedding call. The new path resolves
// everywhere we tested.
//
// Both endpoints return the same model, same 1024-dim
// vector, and the new endpoint's un-normalized output is
// passed through our existing `normalizeL2()` step
// downstream (see callHfApiEmbedding) so the Atlas
// dotProduct index still sees L2-normalized vectors.
const HF_API_BASE = 'https://router.huggingface.co/hf-inference/models';

function getHfApiKey(): string | null {
  return (process.env.HUGGINGFACE_API_KEY ?? '').trim() || null;
}

function shouldUseHfApi(): boolean {
  return getHfApiKey() !== null;
}

/**
 * Call the HF Inference API for a single text. Returns the
 * embedding vector. The API may return either:
 *   - pooled 2D:  [[float, float, ...]]   (most common for
 *                                          sentence-transformers)
 *   - hidden 3D: [[[float, ...], [float, ...], ...]]   (raw
 *                                          last_hidden_state;
 *                                          needs CLS pooling)
 *
 * We detect the shape and either normalize the pooled result
 * or do CLS pooling + normalize the hidden states.
 *
 * v1.70 — Retry wrapper for transient failures.
 *
 * The HF Inference API occasionally aborts mid-request during
 * concurrent-burst conditions (cron startup fires categoryCluster +
 * faqAudit + autoAnswer + popularity simultaneously, easily
 * exceeding the free-tier per-minute rate limit). Node's undici
 * surfaces those as AbortError (err.code === 20, err.name ===
 * 'AbortError', message === 'This operation was aborted'). The
 * 30s timeout here is the upper bound, NOT the abort cause —
 * warm HF calls complete in ~0.3s.
 *
 * We retry once on transient failures with 500ms backoff:
 *   - AbortError (network/keep-alive/rate-limit-disconnect)
 *   - HTTP 429 (rate-limited — worth backing off and retrying)
 *   - HTTP 5xx (transient server error)
 * We do NOT retry:
 *   - HTTP 4xx other than 429 (real bug — surface it)
 *   - JSON parse errors (model returned garbage — surface it)
 *
 * The retry budget is intentionally small: 1 extra attempt. If HF
 * is genuinely down, callers fall through to their existing
 * graceful-degradation paths (empty results, keyword fallback).
 * Bumping retries higher would just add latency to the failure path.
 */
const HF_MAX_RETRIES = 2;          // first attempt + 1 retry
const HF_TIMEOUT_MS  = 30_000;     // per-attempt ceiling
const HF_RETRY_DELAY_MS = 500;     // backoff between attempts

async function callHfApiEmbedding(text: string): Promise<number[]> {
  const apiKey = getHfApiKey();
  if (!apiKey) {
    throw new Error('HUGGINGFACE_API_KEY is not set');
  }
  const url = `${HF_API_BASE}/${MODEL_SLUG}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= HF_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: text,
          options: { wait_for_model: true, use_cache: true },
        }),
        signal: controller.signal,
      });
      clearTimeout(t);

      if (!res.ok) {
        const errText = await res.text().catch(() => '<body unreadable>');
        const err = new Error(`HF Inference API ${res.status}: ${errText}`);
        // 429 (rate-limited) and 5xx are worth one retry; other 4xx are real bugs.
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < HF_MAX_RETRIES) {
          lastError = err;
          logger.warn(`[embeddings] HF API ${res.status} (attempt ${attempt}/${HF_MAX_RETRIES}) — retrying in ${HF_RETRY_DELAY_MS}ms`);
          await new Promise((r) => setTimeout(r, HF_RETRY_DELAY_MS));
          continue;
        }
        throw err;
      }

      const data = await res.json();
      // v1.68.1 — the new router endpoint returns a FLAT
      // 1D array of 1024 numbers (not a 2D nested array).
      // Three valid response shapes from various HF
      // endpoints/versions:
      //
      //   (1) 2D: [batch, dim]                  → [[0.06, 0.29, ...]]
      //       E.g. some legacy endpoints, mxbai hidden states
      //   (2) 1D: [dim]                         → [0.06, 0.29, ...]
      //       E.g. the new router endpoint, fully pooled
      //   (3) 3D: [batch, seq, dim]             → [[[0.06, ...]]]
      //       E.g. mxbai hidden states without CLS pooling
      //
      // The previous code assumed shape (3) and tried to
      // take data[0][0] as the vector — that returned a
      // single number for the new endpoint, and normalizeL2
      // threw "vec is not iterable" trying to for-loop over
      // it. Now we probe the shape first.
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error(`HF Inference API returned unexpected shape: ${JSON.stringify(data).slice(0, 200)}`);
      }
      const first = data[0];
      if (Array.isArray(first)) {
        if (Array.isArray(first[0])) {
          // shape (3): 3D — take CLS token (first token of first sequence)
          return normalizeL2(first[0] as number[]);
        }
        // shape (1): 2D already-pooled, single vector in the batch
        return normalizeL2(first as number[]);
      }
      // shape (2): 1D — data itself is the vector
      return normalizeL2(data as number[]);
    } catch (err) {
      clearTimeout(t);
      const e = err as Error & { code?: number; name?: string };
      // AbortError from undici: err.name === 'AbortError',
      // err.code === 20 (DOMException code for AbortError),
      // err.message === 'This operation was aborted'. The 30s
      // timeout above is one possible trigger, but during cron
      // bursts at server boot the abort typically fires much
      // sooner — undici resets the connection when HF closes it
      // mid-request (rate-limit, transient upstream error).
      // We can't easily distinguish the two from inside the
      // catch, so the retry treats them identically.
      const isAbort = e?.name === 'AbortError' || e?.code === 20;
      if (isAbort && attempt < HF_MAX_RETRIES) {
        lastError = e;
        logger.warn(`[embeddings] HF API call aborted (attempt ${attempt}/${HF_MAX_RETRIES}) — retrying in ${HF_RETRY_DELAY_MS}ms`);
        await new Promise((r) => setTimeout(r, HF_RETRY_DELAY_MS));
        continue;
      }
      // Non-retryable error (or final attempt failed) — bubble up.
      // Don't wrap: callers pattern-match on the error message and
      // a wrapped AbortError would still match `name === 'AbortError'`.
      throw err;
    }
  }
  // Should be unreachable — the loop either returns, throws, or
  // continues. Throw the last error to satisfy TS control flow.
  throw lastError ?? new Error('HF embedding failed after retries');
}

function normalizeL2(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

// ── In-process local pipeline (fallback) ───────────────────────────────
let cachedEmbedder: FeatureExtractionPipeline | null = null;
let isWarmed = false;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!cachedEmbedder) {
    // Keep the ONNX cache in the backend directory so it
    // survives restarts and isn't pulled fresh each time.
    transformersEnv.cacheDir = './.cache/transformers';
    transformersEnv.allowLocalModels = true;
    cachedEmbedder = await pipeline(
      'feature-extraction',
      MODEL_SLUG,
      { dtype: 'fp32' },
    ) as FeatureExtractionPipeline;
    isWarmed = true;
  }
  return cachedEmbedder;
}

/** Warm up the in-process embedding pipeline (no-op if using API). */
export const warmEmbedder = async (): Promise<void> => {
  if (shouldUseHfApi()) return;  // nothing to warm
  await getEmbedder();
};

/**
 * Generate an embedding for a DOCUMENT (FAQ, post, etc.).
 * No prompt prefix — the mxbai paper says don't use the
 * retrieval prompt for documents, only for queries.
 */
export const generateEmbedding = async (text: string): Promise<number[]> => {
  if (shouldUseHfApi()) {
    return callHfApiEmbedding(text);
  }
  const embedder = await getEmbedder();
  const output = await embedder(text, {
    pooling: 'cls',
    normalize: true,
  });
  return Array.from(output.data as Float32Array | number[]);
};

/**
 * Generate an embedding for a SEARCH QUERY.
 * Prepends the retrieval prompt per the mxbai paper. Use
 * this (NOT generateEmbedding) for any text that should be
 * matched against stored document vectors.
 */
export const generateQueryEmbedding = async (query: string): Promise<number[]> => {
  return generateEmbedding(QUERY_PROMPT + query);
};

/** Re-export for diagnostic scripts. True if a warm in-process pipeline exists. */
export const __isWarmed = (): boolean => isWarmed;
