import path from "node:path";
import type { NextConfig } from "next";
import { APP_HOSTS } from "./lib/site";

const nextConfig: NextConfig = {
  // Shared workspace packages (TypeScript source, no build step).
  transpilePackages: ["@mfb/questionbank", "@mfb/engine"],
  // The Excel parser runs only on the server; keep exceljs out of the bundle.
  serverExternalPackages: ["exceljs"],
  allowedDevOrigins: [
    "192.168.29.64",
    "192.168.29.*",
    "localhost",
  ],
  experimental: {
    serverActions: {
      // Question bank Excel upload (the import action also enforces 5 MB).
      bodySizeLimit: "6mb",
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
