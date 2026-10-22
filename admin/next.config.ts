import path from "node:path";
import type { NextConfig } from "next";
import { APP_HOSTS } from "./lib/site";

const isDev = process.env.NODE_ENV !== "production";

// Dev only: phone testing over the local network. Any private address (home and office Wi-Fi hand out
// different ones), so a new IP never blocks the dev server. "*" matches one part of the address.
const LOCAL_NETWORK = ["192.168.*.*", "10.*.*.*", "172.*.*.*"];

// Staff portal: never framed, never indexed by search engines, HTTPS only.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Shared workspace packages (TypeScript source, no build step).
  transpilePackages: ["@mfb/questionnaire"],
  // Server-only library (report PDF renderer); keep it out of the bundle.
  serverExternalPackages: ["@react-pdf/renderer"],
  // The report PDF route reads the brand fonts and PNG logos from disk (lib/report-pdf/assets.ts).
  // Both are copies inside the app: paths outside the app folder are not traced into the deployment.
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/attempts/[id]/pdf": ["./app/fonts/*.ttf", "./assets/report-pdf/*.png"],
  },
  // Dev only: phone testing over the local network. Read when `next dev` starts: restart after a change.
  allowedDevOrigins: ["localhost", ...LOCAL_NETWORK],
  experimental: {
    serverActions: {
      // Questionnaire JSON import (pasted text).
      bodySizeLimit: "6mb",
      allowedOrigins: [
        // Both app origins, from NEXT_PUBLIC_CLIENTS_URL / NEXT_PUBLIC_ADMIN_URL.
        ...APP_HOSTS,
        // Dev only: phone testing over the local network. Never trusted in production.
        ...(isDev ? LOCAL_NETWORK : []),
      ],
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
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
