// App origins come from env (NEXT_PUBLIC_CLIENTS_URL, NEXT_PUBLIC_ADMIN_URL), set in BOTH Vercel projects.
// Without them: the live domains on a Vercel production build (never localhost), the dev ports locally
// (clients 3000, admin 3001).
const IS_VERCEL_PRODUCTION = (process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV) === 'production';
const DEFAULT_CLIENTS_URL = IS_VERCEL_PRODUCTION ? 'https://www.myfitbrain.app' : 'http://localhost:3000';
const DEFAULT_ADMIN_URL = IS_VERCEL_PRODUCTION ? 'https://admin.myfitbrain.app' : 'http://localhost:3001';

function origin(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/\/+$/, '');
}

export const CLIENTS_URL = origin(process.env.NEXT_PUBLIC_CLIENTS_URL, DEFAULT_CLIENTS_URL);
export const ADMIN_URL = origin(process.env.NEXT_PUBLIC_ADMIN_URL, DEFAULT_ADMIN_URL);

/** This app (the client portal). */
export const SITE_URL = CLIENTS_URL;
/** The other app. */
export const OTHER_APP_URL = ADMIN_URL;

/** host[:port] of each app, for allow-lists such as serverActions.allowedOrigins. */
export const APP_HOSTS = [CLIENTS_URL, ADMIN_URL].map((url) => new URL(url).host);
