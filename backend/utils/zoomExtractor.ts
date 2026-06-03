/**
 * Zoom transcript → LLM → structured FAQ + Announcement extraction.
 *
 * Uses the active AI provider resolved via aiProvider.ts (priority
 * Anthropic > OpenAI > xAI > MiniMax), with DB-configured keys/URLs/models
 * honoured when present, otherwise env vars. The transcript is sent as a
 * system + user message and we parse the JSON array response.
 *
 * Prompt design principles:
 *   1. Strict JSON output — model MUST return a JSON array, nothing else.
 *   2. Confidence score — model self-reports 0.0-1.0 so we can filter low-quality extractions.
 *   3. Transcript accuracy caveat — prompt tells model to ignore garbled text.
 *   4. Categorisation — each item is typed as 'FAQ' or 'Announcement'.
 */

import { ZoomInsightType } from '../models/ZoomMeeting.js';
import { resolveProviderAsync } from './aiProvider.js';
import { parseVTTWithSpeakers, extractSnippet, isEmptyTranscript, TranscriptSegment } from './vttParser.js';

export interface ExtractedItem {
  type: ZoomInsightType;
  question?: string;       // only for FAQ
  answer_or_content: string;
  confidence_score: number;
  /** ISO 8601 wall-clock timestamp from the transcript when this Q&A appeared */
  transcriptTimestamp?: string;
  /** Speaker name from the transcript for this Q&A */
  speaker?: string;
  transcript_snippet?: string;
}

/**
 * Parse either raw VTT or plain text. Returns segments (or empty array for plain text).
 */
function parseTranscript(raw: string): TranscriptSegment[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('WEBVTT')) {
    const { warning } = isEmptyTranscript(raw);
    if (warning) console.warn('[zoomExtractor] Transcript below 50 chars — processing anyway.');
    return parseVTTWithSpeakers(raw);
  }
  // Plain .txt: one line = one paragraph
  return trimmed
    .split(/\n\n+/)
    .filter(p => p.trim().length > 0)
    .map((text, i) => ({ speaker: '', text: text.trim(), startSec: i * 60 }));
}

/**
 * System prompt — instructs the model on strict output format.
 */
const SYSTEM_PROMPT = `You are a precise meeting-notes analyst. Your task is to carefully read the provided Zoom meeting transcript and extract:

1. **FAQs** — questions asked during the meeting along with their answers, if the answer was given in the meeting. Include "We don't know yet" or "This was not answered" if the question was raised but unanswered.

2. **Announcements** — definitive statements of decisions, policies, deadlines, or outcomes announced during the meeting.

Output rules (strictly follow these):
- Return ONLY a valid JSON array. No preamble, no explanation, no markdown.
- Each array item MUST have these exact fields: "type" ("FAQ" or "Announcement"), "question" (string, only for FAQ; omit or null for Announcement), "answer_or_content" (string), "confidence_score" (number 0.0 to 1.0, how certain you are this was correctly extracted), "transcript_snippet" (string, max 150 chars, the exact transcript excerpt this was derived from).
- For FAQs, "question" must be a natural question asked by a participant.
- For Announcements, "question" should be null.
- Set confidence_score to 0.0 if the text is garbled, ambiguous, or you're guessing.
- Ignore lines that are just background noise, laughter, or non-substantive filler.
- If nothing meaningful was found, return: []
- Maximum 20 items total.
- Maximum 500 characters in answer_or_content.
- Maximum 150 characters in transcript_snippet.`;

/**
 * Sends cleaned transcript to the active AI provider and returns parsed structured items.
 */
export async function extractInsightsFromTranscript(
  rawTranscript: string,
  meetingTopic: string
): Promise<ExtractedItem[]> {
  // Default empty topic so the LLM prompt is never "Meeting topic: "
  const topic = meetingTopic?.trim() || 'Untitled meeting';

  const cfg = await resolveProviderAsync();
  if (!cfg.apiKey) {
    throw new Error(
      'No AI API key configured. Set ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY / MINIMAX_API_KEY ' +
      'or configure a provider in the admin AI dashboard.'
    );
  }

  // Parse the raw input (VTT or plain text) to get timed segments
  const segments = parseTranscript(rawTranscript);
  const transcript = segments.map(s => `${s.speaker ? s.speaker + ': ' : ''}${s.text}`).join('\n');

  if (!transcript.replace(/\s/g, '')) {
    console.warn('[zoomExtractor] Transcript is empty after parsing, returning no insights.');
    return [];
  }

  // Truncate transcript to ~8 000 tokens to stay within context limits
  const truncated = transcript.length > 60_000 ? transcript.slice(0, 60_000) + '\n[...transcript truncated...]' : transcript;

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Meeting topic: ${meetingTopic}\n\nTranscript:\n${truncated}`,
    },
  ];

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    max_tokens: 2048,
  };
  // temperature is not honoured by Anthropic on /messages; skip it for that provider
  if (!cfg.needsAnthropicVersion) {
    body.temperature = 0.1;
  }

  // Build auth header — Bearer prefix is required by all supported providers
  const authValue = cfg.provider === 'anthropic' ? cfg.apiKey : `Bearer ${cfg.apiKey}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [cfg.authHeader]: authValue,
  };

  let rawContent = '';

  if (cfg.needsAnthropicVersion) {
    headers['anthropic-version'] = '2023-06-01';
    const res = await fetch(`${cfg.baseURL}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, stream: false }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI extraction API error (${res.status}) [anthropic]: ${text}`);
    }
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    rawContent = data.content?.[0]?.text ?? '';
  } else {
    const res = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI extraction API error (${res.status}) [${cfg.provider}]: ${text}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    rawContent = data.choices?.[0]?.message?.content ?? '';
  }

  return parseExtractedItems(rawContent, segments);
}

/**
 * Parse the raw model output, being defensive about malformed responses.
 * Uses actual timed segments to produce accurate transcript snippets.
 */
function parseExtractedItems(raw: string, segments: TranscriptSegment[]): ExtractedItem[] {
  // Try to find a JSON array in the response
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]) as unknown[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is ExtractedItem => {
        if (typeof item !== 'object' || item === null) return false;
        const i = item as Record<string, unknown>;
        return (
          (i.type === 'FAQ' || i.type === 'Announcement') &&
          typeof i.answer_or_content === 'string' &&
          i.answer_or_content.length > 0
        );
      })
      .map((item) => {
        const raw = item as unknown as Record<string, unknown>;
        const confidence = Math.max(0, Math.min(1, Number(raw['confidence_score'] ?? 0)));
        // Use timed snippet extraction if the model reported a rough time offset
        const ts    = String(raw['transcript_timestamp'] ?? '').trim();
        const spkr  = String(raw['speaker']              ?? '').trim();
        // otherwise grab the first segment as a fallback
        const snippetStartSec = typeof raw['start_sec'] === 'number' ? Number(raw['start_sec']) : 0;
        const rawSnippet = extractSnippet(segments, snippetStartSec, 120);
        return {
          type: item.type,
          question: item.question ?? undefined,
          answer_or_content: String(item.answer_or_content).slice(0, 500),
          confidence_score: confidence,
          transcriptTimestamp: ts || undefined,
          speaker: spkr || undefined,
          transcript_snippet: rawSnippet || String(item.transcript_snippet ?? '').slice(0, 150),
        };
      });
  } catch {
    return [];
  }
}
