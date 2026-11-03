import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DRIVE_SCOPE,
  ProofStorageNotConfiguredError,
  ProofUploadError,
  normalizePrivateKey,
  readConfig,
  signedAssertion,
  uploadProof,
} from '../lib/google/drive';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
// As pasted into an env var: one line with literal \n.
const ONE_LINE = PEM.trim().replace(/\n/g, '\n');
const ENV = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'mfb-proofs@mfb-app.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: ONE_LINE,
  GOOGLE_DRIVE_FOLDER_ID: '0AHmgqZYVBp1wUk9PVA',
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('service account settings', () => {
  it('turns literal \n into newlines and strips quotes', () => {
    expect(normalizePrivateKey(`"${ONE_LINE}"`)).toBe(PEM.trim());
  });

  it('accepts complete settings', () => {
    const r = readConfig(ENV);
    expect(r.ok).toBe(true);
  });

  it('names what is missing or invalid, never the values', () => {
    const r = readConfig({ GOOGLE_PRIVATE_KEY: 'not a key', GOOGLE_DRIVE_FOLDER_ID: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems).toEqual([
        'GOOGLE_SERVICE_ACCOUNT_EMAIL is not set',
        'GOOGLE_DRIVE_FOLDER_ID is not a Drive ID',
        'GOOGLE_PRIVATE_KEY is not a valid private key',
      ]);
      expect(r.problems.join(' ')).not.toContain('not a key');
    }
  });
});

describe('signed assertion', () => {
  it('is an RS256 JWT for the drive scope, signed by the key', () => {
    const r = readConfig(ENV);
    if (!r.ok) throw new Error('config');
    const jwt = signedAssertion(r.config, Date.UTC(2026, 10, 3));
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const c = JSON.parse(Buffer.from(claims, 'base64url').toString());
    expect(c).toMatchObject({ iss: ENV.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: DRIVE_SCOPE, aud: 'https://oauth2.googleapis.com/token' });
    expect(c.exp - c.iat).toBe(3600);
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });
});

describe('uploadProof', () => {
  it('refuses when the settings are missing', async () => {
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', '');
    await expect(uploadProof(PNG, 'pay-1')).rejects.toBeInstanceOf(ProofStorageNotConfiguredError);
  });

  it('uploads into the Shared Drive folder with supportsAllDrives and a neutral name', async () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: init.body instanceof Buffer ? init.body.toString('latin1') : String(init.body) });
        if (url.startsWith('https://oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
        }
        return new Response(JSON.stringify({ id: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view' }), { status: 200 });
      })
    );
    const out = await uploadProof(PNG, '7c1e0b6a-0000-4000-8000-000000000001');
    expect(out).toEqual({ fileId: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view' });

    expect(calls[0].body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    const upload = calls.find((c) => c.url.startsWith('https://www.googleapis.com/upload/drive/v3/files'))!;
    expect(upload.url).toContain('supportsAllDrives=true');
    expect(upload.body).toContain(`"parents":["${ENV.GOOGLE_DRIVE_FOLDER_ID}"]`);
    expect(upload.body).toMatch(/"name":"7c1e0b6a-0000-4000-8000-000000000001_\d{4}-\d{2}-\d{2}\.png"/);
    expect(upload.body).toContain('"mimeType":"image/png"');
  });

  it('turns a Google refusal into ProofUploadError carrying Google’s answer (for the server log)', async () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.startsWith('https://oauth2.googleapis.com/token')
          ? new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 })
          : new Response('{"error":{"message":"File not found: 0AHmgqZYVBp1wUk9PVA."}}', { status: 404 })
      )
    );
    const err = await uploadProof(PNG, 'pay-2').catch((e) => e);
    expect(err).toBeInstanceOf(ProofUploadError);
    expect(err.message).toContain('HTTP 404');
    expect(err.message).toContain('File not found');
  });
});
