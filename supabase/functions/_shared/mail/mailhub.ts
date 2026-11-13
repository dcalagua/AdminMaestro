/**
 * Cliente mínimo de EBIM MailHub (`POST /mailhub-send`).
 *
 * Módulo PURO con `fetch` inyectado: lo prueba vitest.
 *
 *   · Plantillas centralizadas: `content.type = "template"` con la clave
 *     `masteradmin-…`; MailHub escapa cada variable y usa la versión publicada.
 *   · `idempotencyKey` estable por evento: un reintento con la misma clave no
 *     duplica el correo (MailHub responde 202 + `Idempotent-Replayed`).
 *   · `x-region: us-east-1` (región de la base de MailHub; ~0,4 s en vez de 1-2 s).
 *   · Timeout de 10 s. Se reintenta SOLO lo que MailHub declara reintentable:
 *     red/timeout, 429 y 5xx. Un 4xx es definitivo (configuración o datos).
 *   · Nunca se registra el token ni el cuerpo de la respuesta completo.
 */

export const MAILHUB_TIMEOUT_MS = 10_000;
export const MAIL_MAX_ATTEMPTS = 8;

export interface MailhubConfig {
  /** Base de funciones de MailHub, p. ej. https://<ref>.supabase.co/functions/v1 */
  functionsUrl: string;
  /** Token `mh_<env>_…` (solo servidor). */
  apiKey: string;
}

export interface MailhubSendRequest {
  to: string[];
  templateKey: string;
  variables: Record<string, string>;
  idempotencyKey: string;
  referenceId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export type MailhubSendResult =
  | { ok: true; emailId: string; status: string; replayed: boolean; suppressed: string[] }
  | { ok: false; retryable: boolean; httpStatus: number | null; code: string; message: string };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function parseMailhubConfig(env: (name: string) => string | undefined): MailhubConfig | null {
  const url = (env('MAILHUB_FUNCTIONS_URL') ?? '').trim().replace(/\/+$/, '');
  const apiKey = (env('MAILHUB_API_KEY') ?? '').trim();
  if (!/^https:\/\/[^\s]+$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal)(:\d+)?\//.test(`${url}/`)) {
    return null;
  }
  if (!/^mh_[a-z]+_/.test(apiKey)) return null;
  return { functionsUrl: url, apiKey };
}

/** Metadatos: ≤ 20 claves escalares y sin datos sensibles (contrato de MailHub). */
function cleanMetadata(meta: MailhubSendRequest['metadata']): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = { source: 'masteradmin' };
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (Object.keys(out).length >= 20) break;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
    }
  }
  return out;
}

export function buildSendBody(req: MailhubSendRequest): Record<string, unknown> {
  return {
    to: req.to,
    content: { type: 'template', templateKey: req.templateKey, variables: req.variables },
    idempotencyKey: req.idempotencyKey.slice(0, 255),
    ...(req.referenceId ? { referenceId: req.referenceId.slice(0, 200) } : {}),
    metadata: cleanMetadata(req.metadata),
  };
}

export async function sendViaMailhub(
  cfg: MailhubConfig,
  req: MailhubSendRequest,
  fetchImpl: FetchLike,
  timeoutMs = MAILHUB_TIMEOUT_MS,
): Promise<MailhubSendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.functionsUrl}/mailhub-send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mailhub-key': cfg.apiKey,
        'x-region': 'us-east-1',
      },
      body: JSON.stringify(buildSendBody(req)),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = (error as { name?: string })?.name === 'AbortError';
    return {
      ok: false,
      retryable: true,
      httpStatus: null,
      code: aborted ? 'timeout' : 'network_error',
      message: aborted ? 'MailHub no respondió a tiempo' : 'No se pudo conectar con MailHub',
    };
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status === 202 || res.status === 200) {
    const emailId = typeof body?.emailId === 'string' ? body.emailId : '';
    if (!emailId) {
      return { ok: false, retryable: true, httpStatus: res.status, code: 'invalid_response', message: 'MailHub no devolvió emailId' };
    }
    return {
      ok: true,
      emailId,
      status: typeof body?.status === 'string' ? body.status : 'queued',
      replayed: res.headers.get('idempotent-replayed') === 'true',
      suppressed: Array.isArray(body?.suppressedRecipients) ? (body.suppressedRecipients as string[]) : [],
    };
  }
  const err = (body?.error ?? {}) as { code?: string; message?: string };
  const code = typeof err.code === 'string' ? err.code : `http_${res.status}`;
  const message = typeof err.message === 'string' ? err.message.slice(0, 300) : `MailHub respondió ${res.status}`;
  return { ok: false, retryable: res.status === 429 || res.status >= 500, httpStatus: res.status, code, message };
}

/** Backoff exponencial con tope: 1, 2, 4, 8, 16, 32, 64 min… hasta 6 h. */
export function nextRetryDelaySeconds(attempt: number): number {
  const base = 60 * 2 ** Math.max(0, attempt - 1);
  return Math.min(base, 6 * 60 * 60);
}
