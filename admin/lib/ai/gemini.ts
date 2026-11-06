import 'server-only';

// Google Gemini (Generative Language API), one call: a system prompt and a user text in, JSON text out.
// Plain fetch, no library. Env (admin app, server only):
//   GEMINI_API_KEY   from Google AI Studio (aistudio.google.com → Get API key). Use a key on a project
//                    with billing on: on the free tier Google may use the prompts to improve its products.
//   GEMINI_MODEL     optional, default below.
// Google's real errors are logged on the server only; callers show plain messages.

const DEFAULT_MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 45_000;

export class AiNotConfiguredError extends Error {
  constructor() {
    super('GEMINI_API_KEY is not set');
    this.name = 'AiNotConfiguredError';
  }
}

export class AiRequestError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'AiRequestError';
  }
}

export function isAiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY?.trim();
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

/** Returns the model's JSON answer as text (responseMimeType application/json with the given schema). */
export async function generateJson(opts: { system: string; user: string; schema: object; temperature?: number }): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new AiNotConfiguredError();
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  if (!/^[a-z0-9.\-]+$/i.test(model)) throw new AiRequestError(`GEMINI_MODEL is not a model name: ${model}`);

  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts: [{ text: opts.user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: opts.schema,
          temperature: opts.temperature ?? 0.6,
          maxOutputTokens: 8192,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    throw new AiRequestError(`Gemini request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const data = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) throw new AiRequestError(`Gemini ${res.status}: ${data.error?.status ?? ''} ${data.error?.message ?? ''}`.trim());
  if (data.promptFeedback?.blockReason) throw new AiRequestError(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (!text) throw new AiRequestError(`Gemini returned no text (finishReason ${candidate?.finishReason ?? 'none'})`);
  return text;
}
