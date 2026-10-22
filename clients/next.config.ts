import path from "node:path";
import type { NextConfig } from "next";
import { APP_HOSTS } from "./lib/site";

const isDev = process.env.NODE_ENV !== "production";

// Dev only: phone testing over the local network. Any private address (home and office Wi-Fi hand out
// different ones), so a new IP never blocks the dev server. "*" matches one part of the address.
const LOCAL_NETWORK = ["192.168.*.*", "10.*.*.*", "172.*.*.*"];

// Security headers for every response. HSTS: HTTPS only (Vercel serves HTTPS).
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Razorpay checkout may ask for the payment request API; nothing else is used.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\" \"https://api.razorpay.com\")" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Monorepo: trace server files from the repo root (packages/ live outside this app).
  outputFileTracingRoot: path.join(__dirname, ".."),
  // Shared workspace packages (TypeScript source, no build step).
  transpilePackages: ["@mfb/questionnaire"],
  // Dev only: phone testing over the local network. Read when `next dev` starts: restart after a change.
  allowedDevOrigins: ["localhost", ...LOCAL_NETWORK],
  experimental: {
    serverActions: {
      allowedOrigins: [
        // Both app origins, from NEXT_PUBLIC_CLIENTS_URL / NEXT_PUBLIC_ADMIN_URL.
        ...APP_HOSTS,
        // Dev only: phone testing over the local network. Never trusted in production.
        ...(isDev ? LOCAL_NETWORK : []),
      ],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
      {
        // Service worker must never be cached, so updates reach installed apps.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  turbopack: {
    // Monorepo: resolve workspace packages from the repo root.
    root: path.join(__dirname, ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
