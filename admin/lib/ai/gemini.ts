import 'server-only';

// Google Gemini through the Interactions API (POST /v1beta/interactions, API revision below), one call:
// a system instruction and a user text in, JSON text out. Plain fetch, no library. store: false, so
// Google keeps no server-side copy of the conversation. Env (admin app, server only):
//   GEMINI_API_KEY   from Google AI Studio (aistudio.google.com → Get API key). Use a key on a project
//                    with billing on: on the free tier Google may use the prompts to improve its products.
//   GEMINI_MODEL     optional, default below. When it is busy (429, 5xx or no answer in time) the call is
//                    tried once more on FALLBACK_MODEL, a stable model.
// Gemini 3.6+ ignores temperature / top_p / top_k, so none are sent.
// Google's real errors are logged on the server only; callers show plain messages.

const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-3.6-flash';
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION = '2026-05-20';
/** Per try: the main model gets 25 s, the fallback 30 s (both fit in one server action). */
const TIMEOUT_MS = [25_000, 30_000];

export class AiNotConfiguredError extends Error {
  constructor() {
    super('GEMINI_API_KEY is not set');
    this.name = 'AiNotConfiguredError';
  }
}

export class AiRequestError extends Error {
  /** Overloaded or slow: worth trying another model. */
  readonly busy: boolean;
  constructor(detail: string, busy = false) {
    super(detail);
    this.name = 'AiRequestError';
    this.busy = busy;
  }
}

export function isAiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY?.trim();
}

interface InteractionResponse {
  status?: string;
  steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
  error?: { code?: number; message?: string; status?: string };
}

interface AiRequest {
  system: string;
  user: string;
  schema: object;
}

/** The text of the model_output steps of an Interaction (thought steps are skipped). */
export function interactionText(data: InteractionResponse): string {
  return (data.steps ?? [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
}

/** Returns the model's JSON answer as text (response_format application/json with the given JSON Schema). */
export async function generateJson(opts: AiRequest): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new AiNotConfiguredError();
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  if (!/^[a-z0-9.-]+$/i.test(model)) throw new AiRequestError(`GEMINI_MODEL is not a model name: ${model}`);

  const models = model === FALLBACK_MODEL ? [model] : [model, FALLBACK_MODEL];
  for (let i = 0; ; i++) {
    try {
      return await interact(key, models[i], opts, TIMEOUT_MS[Math.min(i, TIMEOUT_MS.length - 1)]);
    } catch (err) {
      if (!(err instanceof AiRequestError) || !err.busy || i === models.length - 1) throw err;
      console.warn(`${err.message}; trying ${models[i + 1]}`);
    }
  }
}

async function interact(key: string, model: string, opts: AiRequest, timeoutMs: number): Promise<string> {
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, 'Api-Revision': API_REVISION },
      body: JSON.stringify({
        model,
        system_instruction: opts.system,
        input: opts.user,
        response_format: { type: 'text', mime_type: 'application/json', schema: opts.schema },
        generation_config: { max_output_tokens: 4096, thinking_level: 'low' },
        store: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (err) {
    throw new AiRequestError(`Gemini ${model} request failed: ${err instanceof Error ? err.message : String(err)}`, true);
  }

  const data = (await res.json().catch(() => ({}))) as InteractionResponse;
  if (!res.ok) {
    const busy = res.status === 429 || res.status >= 500;
    throw new AiRequestError(`Gemini ${model} ${res.status}: ${data.error?.status ?? ''} ${data.error?.message ?? ''}`.trim(), busy);
  }
  if (data.status && data.status !== 'completed') throw new AiRequestError(`Gemini ${model} interaction status ${data.status}`);
  const text = interactionText(data);
  if (!text) throw new AiRequestError(`Gemini ${model} returned no text`);
  return text;
}
