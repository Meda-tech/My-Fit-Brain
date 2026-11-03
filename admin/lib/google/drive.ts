import 'server-only';
import { createPrivateKey, createSign, randomBytes, type KeyObject } from 'node:crypto';
import { detectProofType, indiaToday, proofFileName } from '../offline-payments';

// Google Drive storage for offline payment proofs, with a service account. ALL Google code lives here,
// so the storage can be swapped later by replacing this one module (callers use uploadProof() and
// isProofStorageConfigured() only).
//
// The service account signs a short JWT with its private key, exchanges it for an access token (scope
// drive), and uploads into GOOGLE_DRIVE_FOLDER_ID, a Shared Drive (or a folder in one) where the
// service account is a member with Content manager rights. supportsAllDrives is set on every call.
// Env (admin app, server only):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   e.g. mfb-proofs@<project>.iam.gserviceaccount.com
//   GOOGLE_PRIVATE_KEY             the key's "-----BEGIN PRIVATE KEY-----…" text; literal \n become newlines
//   GOOGLE_DRIVE_FOLDER_ID         the Shared Drive ID (or a folder ID inside it)
// Google's real errors are logged on the server only; callers show plain messages.

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const TIMEOUT_MS = 20_000;

/** Proof storage is not set up (env missing or invalid). */
export class ProofStorageNotConfiguredError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ProofStorageNotConfiguredError';
  }
}

/** Google refused or failed (the message holds Google's answer; log it, never show it). */
export class ProofUploadError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ProofUploadError';
  }
}

export interface ServiceAccountConfig {
  email: string;
  key: KeyObject;
  folderId: string;
}

/** The key text as Google gives it: literal "\n" turned into newlines, surrounding quotes removed. */
export function normalizePrivateKey(raw: string): string {
  return raw.trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n');
}

/** The service account settings, or the names of what is missing or invalid (never the values). */
export function readConfig(env: Record<string, string | undefined> = process.env):{ ok: true; config: ServiceAccountConfig } | { ok: false; problems: string[] } {
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() ?? '';
  const rawKey = env.GOOGLE_PRIVATE_KEY ?? '';
  const folderId = env.GOOGLE_DRIVE_FOLDER_ID?.trim() ?? '';
  const problems: string[] = [];
  if (!email) problems.push('GOOGLE_SERVICE_ACCOUNT_EMAIL is not set');
  else if (!/^[^@\s]+@[^@\s]+$/.test(email)) problems.push('GOOGLE_SERVICE_ACCOUNT_EMAIL is not an email address');
  if (!folderId) problems.push('GOOGLE_DRIVE_FOLDER_ID is not set');
  else if (!/^[A-Za-z0-9_-]{10,200}$/.test(folderId)) problems.push('GOOGLE_DRIVE_FOLDER_ID is not a Drive ID');
  let key: KeyObject | null = null;
  if (!rawKey.trim()) problems.push('GOOGLE_PRIVATE_KEY is not set');
  else {
    try {
      key = createPrivateKey(normalizePrivateKey(rawKey));
    } catch {
      problems.push('GOOGLE_PRIVATE_KEY is not a valid private key');
    }
  }
  if (problems.length || !key) return { ok: false, problems };
  return { ok: true, config: { email, key, folderId } };
}

/** True when proofs can be uploaded (all three env values set and valid). */
export function isProofStorageConfigured(): boolean {
  return readConfig().ok;
}

/** The signed JWT the service account exchanges for an access token (RS256, valid one hour). */
export function signedAssertion(config: Pick<ServiceAccountConfig, 'email' | 'key'>, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: config.email, scope: DRIVE_SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(config.key).toString('base64url');
  return `${unsigned}.${signature}`;
}

// One access token per server instance, reused until a minute before it expires.
let cached: { email: string; token: string; expiresAt: number } | null = null;

async function accessToken(config: ServiceAccountConfig): Promise<string> {
  if (cached && cached.email === config.email && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedAssertion(config) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  const text = await res.text();
  let json: { access_token?: string; expires_in?: number } = {};
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: reported below with the raw text.
  }
  if (!res.ok || !json.access_token) throw new ProofUploadError(`Token request failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
  cached = { email: config.email, token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

export interface UploadedProof {
  fileId: string;
  webViewLink: string;
}

/**
 * Uploads a payment proof into GOOGLE_DRIVE_FOLDER_ID. File name = payment ID + date (India), never the
 * client's name. The type comes from the file's bytes, not its name. Throws
 * ProofStorageNotConfiguredError or ProofUploadError.
 */
export async function uploadProof(file: Uint8Array, paymentId: string): Promise<UploadedProof> {
  const read = readConfig();
  if (!read.ok) throw new ProofStorageNotConfiguredError(read.problems.join('; '));
  const { config } = read;
  const type = detectProofType(file);
  if (!type) throw new ProofUploadError('Unsupported proof type.');

  const token = await accessToken(config);
  const boundary = `mfb-${randomBytes(16).toString('hex')}`;
  const metadata = JSON.stringify({ name: proofFileName(paymentId, indiaToday(), type), parents: [config.folderId], mimeType: type });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`),
    Buffer.from(file),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await fetch(`${UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  const text = await res.text();
  if (res.status === 401) cached = null; // a revoked token is fetched anew next time
  if (!res.ok) throw new ProofUploadError(`Upload failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
  let f: { id?: string; webViewLink?: string } = {};
  try {
    f = JSON.parse(text);
  } catch {
    // handled below
  }
  if (!f.id || !f.webViewLink) throw new ProofUploadError(`Upload returned no file: ${text.slice(0, 500)}`);
  return { fileId: f.id, webViewLink: f.webViewLink };
}
