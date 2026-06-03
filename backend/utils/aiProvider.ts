/**
 * Shared AI provider resolution.
 *
 * Used by any module that makes direct AI API calls (duplicateDetector,
 * knowledgeBase, etc.) BEFORE AiClient is available or when you just need
 * the provider config without instantiating a full client.
 *
 * Provider priority: Anthropic > OpenAI > xAI > MiniMax
 *
 * Resolution order for API key / base URL:
 *   1. Admin-configured value in the AiConfig DB document (set via the dashboard)
 *   2. Environment variable fallback
 *   3. Provider default
 *
 * The DB value is read fresh on every call (no module-level caching) so that
 * an admin change in the dashboard takes effect immediately for new requests.
 */

import AiConfig from '../models/AiConfig.js';

export type AIProvider = 'anthropic' | 'openai' | 'xai' | 'minimax';

export interface ProviderConfig {
  provider: AIProvider;
  apiKey: string;
  baseURL: string;
  model: string;
  authHeader: 'x-api-key' | 'Authorization';
  needsAnthropicVersion: boolean;
}

const PROVIDER_DEFAULTS: Record<AIProvider, Omit<ProviderConfig, 'apiKey' | 'baseURL' | 'model'>> = {
  anthropic: { provider: 'anthropic', authHeader: 'x-api-key',     needsAnthropicVersion: true },
  openai:    { provider: 'openai',    authHeader: 'Authorization', needsAnthropicVersion: false },
  xai:       { provider: 'xai',       authHeader: 'Authorization', needsAnthropicVersion: false },
  minimax:   { provider: 'minimax',   authHeader: 'Authorization', needsAnthropicVersion: false },
};

const DEFAULT_BASE_URLS: Record<AIProvider, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai:    'https://api.openai.com/v1',
  xai:       'https://api.x.ai/v1',
  minimax:   'https://api.minimax.io/v1',
};

const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai:    'gpt-4o-mini',
  xai:       'grok-3',
  minimax:   'MiniMax-Text-01',
};

const ENV_KEY: Record<AIProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai:    'OPENAI_API_KEY',
  xai:       'XAI_API_KEY',
  minimax:   'MINIMAX_API_KEY',
};
const ENV_MODEL: Record<AIProvider, string> = {
  anthropic: 'ANTHROPIC_MODEL',
  openai:    'OPENAI_MODEL',
  xai:       'XAI_MODEL',
  minimax:   'MINIMAX_MODEL',
};
const ENV_BASE_URL: Record<AIProvider, string> = {
  anthropic: 'ANTHROPIC_BASE_URL',
  openai:    'OPENAI_BASE_URL',
  xai:       'XAI_BASE_URL',
  minimax:   'MINIMAX_BASE_URL',
};

// ── DB override cache (TTL 5s) ──────────────────────────────────────────────
// Saves a Mongo roundtrip per call when the dashboard hasn't been touched recently.

interface DbOverrides {
  anthropic: { apiKey: string; baseURL: string; model: string };
  openai:    { apiKey: string; baseURL: string; model: string };
  xai:       { apiKey: string; baseURL: string; model: string };
  minimax:   { apiKey: string; baseURL: string; model: string };
};

let _cache: { value: DbOverrides; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5_000;

async function loadDbOverrides(): Promise<DbOverrides> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.value;
  try {
    const config = await AiConfig.findOne({ isActive: true });
    const v: DbOverrides = {
      anthropic: { apiKey: config?.getApiKey('anthropic') ?? '', baseURL: config?.providers?.anthropic?.baseURL ?? '', model: config?.providers?.anthropic?.model ?? '' },
      openai:    { apiKey: config?.getApiKey('openai')    ?? '', baseURL: config?.providers?.openai?.baseURL    ?? '', model: config?.providers?.openai?.model    ?? '' },
      xai:       { apiKey: config?.getApiKey('xai')       ?? '', baseURL: config?.providers?.xai?.baseURL       ?? '', model: config?.providers?.xai?.model       ?? '' },
      minimax:   { apiKey: config?.getApiKey('minimax')   ?? '', baseURL: config?.providers?.minimax?.baseURL   ?? '', model: config?.providers?.minimax?.model   ?? '' },
    };
    _cache = { value: v, expiresAt: Date.now() + CACHE_TTL_MS };
    return v;
  } catch {
    // DB unavailable — return empty overrides so we fall back to env
    return {
      anthropic: { apiKey: '', baseURL: '', model: '' },
      openai:    { apiKey: '', baseURL: '', model: '' },
      xai:       { apiKey: '', baseURL: '', model: '' },
      minimax:   { apiKey: '', baseURL: '', model: '' },
    };
  }
}

/** Invalidate the DB override cache. Call after admin updates config. */
export function invalidateProviderCache(): void {
  _cache = null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a full ProviderConfig for a given provider, applying DB → env → default order.
 */
export async function resolveProviderAsync(provider?: AIProvider): Promise<ProviderConfig> {
  const db = await loadDbOverrides();

  // If no provider passed, pick the first one with a key (priority: anthropic > openai > xai > minimax)
  let chosen: AIProvider;
  if (provider) {
    chosen = provider;
  } else {
    chosen = (
      (db.anthropic.apiKey || process.env.ANTHROPIC_API_KEY) ? 'anthropic' :
      (db.openai.apiKey    || process.env.OPENAI_API_KEY)    ? 'openai'    :
      (db.xai.apiKey       || process.env.XAI_API_KEY)       ? 'xai'       :
      'minimax'
    ) as AIProvider;
  }

  const override = db[chosen];
  const apiKey  = override.apiKey  || process.env[ENV_KEY[chosen]]      || '';
  const baseURL = (override.baseURL || process.env[ENV_BASE_URL[chosen]] || DEFAULT_BASE_URLS[chosen]).replace(/\/$/, '');
  const model   = override.model    || process.env[ENV_MODEL[chosen]]   || DEFAULT_MODELS[chosen];

  return {
    ...PROVIDER_DEFAULTS[chosen],
    provider: chosen,
    apiKey,
    baseURL,
    model,
  };
}

/**
 * Synchronous resolve — only uses env vars (no DB). Used by legacy sync code paths
 * and during initial module load. New code should prefer resolveProviderAsync().
 */
export function resolveProvider(): ProviderConfig {
  if (process.env.ANTHROPIC_API_KEY) {
    return { ...PROVIDER_DEFAULTS.anthropic, provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, baseURL: envBaseUrl('anthropic'), model: envModel('anthropic') };
  }
  if (process.env.OPENAI_API_KEY) {
    return { ...PROVIDER_DEFAULTS.openai,    provider: 'openai',    apiKey: process.env.OPENAI_API_KEY,    baseURL: envBaseUrl('openai'),    model: envModel('openai') };
  }
  if (process.env.XAI_API_KEY) {
    return { ...PROVIDER_DEFAULTS.xai,       provider: 'xai',       apiKey: process.env.XAI_API_KEY,       baseURL: envBaseUrl('xai'),       model: envModel('xai') };
  }
  if (process.env.MINIMAX_API_KEY || process.env.MINIMAX_BASE_URL) {
    return { ...PROVIDER_DEFAULTS.minimax,   provider: 'minimax',   apiKey: process.env.MINIMAX_API_KEY ?? '', baseURL: envBaseUrl('minimax'), model: envModel('minimax') };
  }
  throw new Error(
    'No AI API key configured. Set one of:\n' +
    '  ANTHROPIC_API_KEY  — https://console.anthropic.com/settings/keys\n' +
    '  OPENAI_API_KEY     — https://platform.openai.com/api-keys\n' +
    '  XAI_API_KEY        — https://console.x.ai/\n' +
    '  MINIMAX_API_KEY    — https://platform.minimax.io'
  );
}

function envBaseUrl(p: AIProvider): string {
  return (process.env[ENV_BASE_URL[p]] ?? DEFAULT_BASE_URLS[p]).replace(/\/$/, '');
}
function envModel(p: AIProvider): string {
  return process.env[ENV_MODEL[p]] ?? DEFAULT_MODELS[p];
}

/** Returns true if at least one AI API key is configured (env or DB). */
export async function hasAIKeyAsync(): Promise<boolean> {
  const db = await loadDbOverrides();
  return !!(
    db.anthropic.apiKey || process.env.ANTHROPIC_API_KEY ||
    db.openai.apiKey    || process.env.OPENAI_API_KEY    ||
    db.xai.apiKey       || process.env.XAI_API_KEY       ||
    db.minimax.apiKey   || process.env.MINIMAX_API_KEY
  );
}

/** Returns true if at least one AI API key is configured in env (sync). */
export function hasAIKey(): boolean {
  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.XAI_API_KEY ||
    process.env.MINIMAX_API_KEY
  );
}

/** Resolve config for a specific provider from env (sync, no DB). */
export function getProvider(provider: AIProvider): ProviderConfig {
  return {
    ...PROVIDER_DEFAULTS[provider],
    provider,
    apiKey: process.env[ENV_KEY[provider]] ?? '',
    baseURL: envBaseUrl(provider),
    model: envModel(provider),
  };
}

/** Async resolve for a specific provider (checks DB then env). */
export async function getProviderAsync(provider: AIProvider): Promise<ProviderConfig> {
  return resolveProviderAsync(provider);
}

// ── Chat (low-level, uses async resolution) ─────────────────────────────────

/**
 * Chat against a specific provider. Always checks the DB first for keys/URLs.
 * Used by test connections and by call-sites that have already chosen a provider.
 */
export async function chatWithProvider(
  provider: AIProvider,
  messages: { role: string; content: string }[],
  model?: string,
): Promise<string> {
  const config = await resolveProviderAsync(provider);
  const modelName = model || config.model;

  if (provider === 'anthropic') {
    const res = await fetch(`${config.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: modelName, messages, max_tokens: 4 }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic error: ${err}`);
    }
    const data = await res.json() as { content?: { text?: string }[] };
    return data.content?.[0]?.text ?? '';
  }

  // OpenAI / xAI / MiniMax all use chat completions
  const body: Record<string, unknown> = { model: modelName, messages };
  const res = await fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      [config.authHeader]: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${provider} error: ${err}`);
  }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

// Backward-compat export — used by aiController.testProvider via dynamic import
export const chat = chatWithProvider;
