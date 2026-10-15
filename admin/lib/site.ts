// App origins come from env so nothing is hard-wired to a domain.
// Local defaults match the dev ports (clients 3000, admin 3001).
// Production: https://app.myfitbrain.app and https://admin.myfitbrain.app (set in env).
const DEFAULT_CLIENTS_URL = 'http://localhost:3000';
const DEFAULT_ADMIN_URL = 'http://localhost:3001';

function origin(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/\/+$/, '');
}

export const CLIENTS_URL = origin(process.env.NEXT_PUBLIC_CLIENTS_URL, DEFAULT_CLIENTS_URL);
export const ADMIN_URL = origin(process.env.NEXT_PUBLIC_ADMIN_URL, DEFAULT_ADMIN_URL);

/** This app (the staff portal). */
export const SITE_URL = ADMIN_URL;
/** The other app. */
export const OTHER_APP_URL = CLIENTS_URL;

/** host[:port] of each app, for allow-lists such as serverActions.allowedOrigins. */
export const APP_HOSTS = [CLIENTS_URL, ADMIN_URL].map((url) => new URL(url).host);
