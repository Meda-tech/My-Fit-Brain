import path from "node:path";
import type { NextConfig } from "next";
import { APP_HOSTS } from "./lib/site";

const nextConfig: NextConfig = {
  // Shared workspace packages (TypeScript source, no build step).
  transpilePackages: ["@mfb/questionbank"],
  allowedDevOrigins: [
    "192.168.29.64",
    "192.168.29.*",
    "localhost",
  ],
  experimental: {
    serverActions: {
      allowedOrigins: [
        // Both app origins, from NEXT_PUBLIC_CLIENTS_URL / NEXT_PUBLIC_ADMIN_URL.
        ...APP_HOSTS,
        // Dev only: phone testing over the local network.
        "192.168.29.64:3000",
        "192.168.29.64:3001",
        "192.168.29.64",
      ],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
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
