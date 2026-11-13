/**
 * Firmas de los dos webhooks que recibe el correo del Admin Maestro.
 *
 * Módulo PURO (solo WebCrypto, sin Deno): lo prueba vitest.
 *
 *   · Supabase Auth «Send Email Hook» → Standard Webhooks:
 *       webhook-id, webhook-timestamp, webhook-signature = "v1,<base64>" [espacio "v1,<base64>"…]
 *       firma = base64(HMAC_SHA256(base64decode(secreto), `${id}.${timestamp}.${cuerpo}`))
 *       secreto configurado como "v1,whsec_<base64>".
 *   · EBIM MailHub (callbacks de entrega):
 *       X-MailHub-Timestamp, X-MailHub-Signature = "sha256=<hex>"[,"sha256=<hex>"]
 *       firma = hex(HMAC_SHA256(secreto, `${timestamp}.${cuerpo}`)), secreto "mhsec_…" tal cual.
 *
 * Ambas se verifican sobre el cuerpo CRUDO, con ventana anti-replay de 300 s y
 * comparación en tiempo constante. Durante una rotación llegan varias firmas:
 * basta con que UNA coincida.
 */

export const SIGNATURE_TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

/** Comparación en tiempo constante (no corta en la primera diferencia). */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, encoder.encode(message)));
}

function withinWindow(timestamp: string | null, nowSeconds: number): boolean {
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  return Math.abs(nowSeconds - Number(timestamp)) <= SIGNATURE_TOLERANCE_SECONDS;
}

export type SignatureFailure = 'MISSING_HEADERS' | 'STALE_TIMESTAMP' | 'BAD_SIGNATURE' | 'BAD_SECRET';

export type SignatureCheck = { ok: true } | { ok: false; reason: SignatureFailure };

/** Secreto del hook de Auth: acepta "v1,whsec_<b64>", "whsec_<b64>" o el base64 pelado. */
export function standardWebhookKey(secret: string): Uint8Array | null {
  const raw = secret.trim().replace(/^v1,/, '').replace(/^whsec_/, '');
  if (!raw) return null;
  try {
    const key = base64ToBytes(raw);
    return key.length >= 16 ? key : null;
  } catch {
    return null;
  }
}

export async function verifyStandardWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  nowSeconds: number,
): Promise<SignatureCheck> {
  const key = standardWebhookKey(secret);
  if (!key) return { ok: false, reason: 'BAD_SECRET' };
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, reason: 'MISSING_HEADERS' };
  if (!withinWindow(headers.timestamp, nowSeconds)) return { ok: false, reason: 'STALE_TIMESTAMP' };
  const expected = bytesToBase64(await hmacSha256(key, `${headers.id}.${headers.timestamp}.${rawBody}`));
  const presented = headers.signature
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice(3));
  return presented.some((sig) => constantTimeEqual(sig, expected)) ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
}

export async function verifyMailhubSignature(
  secret: string,
  headers: { timestamp: string | null; signature: string | null },
  rawBody: string,
  nowSeconds: number,
): Promise<SignatureCheck> {
  if (!secret.trim()) return { ok: false, reason: 'BAD_SECRET' };
  if (!headers.timestamp || !headers.signature) return { ok: false, reason: 'MISSING_HEADERS' };
  if (!withinWindow(headers.timestamp, nowSeconds)) return { ok: false, reason: 'STALE_TIMESTAMP' };
  const expected = `sha256=${bytesToHex(await hmacSha256(encoder.encode(secret.trim()), `${headers.timestamp}.${rawBody}`))}`;
  const presented = headers.signature.split(',').map((part) => part.trim()).filter(Boolean);
  return presented.some((sig) => constantTimeEqual(sig, expected)) ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
}

/** Solo para pruebas y para el simulador local: firma como lo haría cada emisor. */
export async function signStandardWebhook(secret: string, id: string, timestamp: string, rawBody: string): Promise<string> {
  const key = standardWebhookKey(secret);
  if (!key) throw new Error('BAD_SECRET');
  return `v1,${bytesToBase64(await hmacSha256(key, `${id}.${timestamp}.${rawBody}`))}`;
}

export async function signMailhub(secret: string, timestamp: string, rawBody: string): Promise<string> {
  return `sha256=${bytesToHex(await hmacSha256(encoder.encode(secret), `${timestamp}.${rawBody}`))}`;
}
