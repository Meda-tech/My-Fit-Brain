import path from "node:path";
import type { NextConfig } from "next";
import { APP_HOSTS } from "./lib/site";

const isDev = process.env.NODE_ENV !== "production";

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
  transpilePackages: ["@mfb/questionbank", "@mfb/engine", "@mfb/report"],
  // Server-only libraries (Excel parser, report PDF renderer); keep them out of the bundle.
  serverExternalPackages: ["exceljs", "@react-pdf/renderer"],
  // The report PDF route reads the brand fonts and PNG logos from disk (lib/report-pdf/assets.ts).
  // Both are copies inside the app: paths outside the app folder are not traced into the deployment.
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/attempts/[id]/pdf": ["./app/fonts/*.ttf", "./assets/report-pdf/*.png"],
  },
  // Dev only: phone testing over the local network.
  allowedDevOrigins: ["192.168.29.64", "192.168.29.*", "localhost"],
  experimental: {
    serverActions: {
      // Question bank Excel upload (the import action also enforces 5 MB).
      bodySizeLimit: "6mb",
      allowedOrigins: [
        // Both app origins, from NEXT_PUBLIC_CLIENTS_URL / NEXT_PUBLIC_ADMIN_URL.
        ...APP_HOSTS,
        // Dev only: phone testing over the local network. Never trusted in production.
        ...(isDev ? ["192.168.29.64:3000", "192.168.29.64:3001", "192.168.29.64"] : []),
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
