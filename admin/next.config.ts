import path from "node:path";
import type { NextConfig } from "next";
import { APP_HOSTS } from "./lib/site";

const nextConfig: NextConfig = {
  // Shared workspace packages (TypeScript source, no build step).
  transpilePackages: ["@mfb/questionbank", "@mfb/engine", "@mfb/report"],
  // Server-only libraries (Excel parser, report PDF renderer); keep them out of the bundle.
  serverExternalPackages: ["exceljs", "@react-pdf/renderer"],
  // The report PDF route reads the brand fonts and PNG logos from disk (lib/report-pdf/assets.ts).
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/attempts/[id]/pdf": [
      "./app/fonts/*.ttf",
      "../brand/01_Logo/PNG/Endorsed_FoundedBy/MFB_Endorsed_FoundedBy_FullColour.png",
      "../brand/01_Logo/PNG/Horizontal/MFB_Horizontal_FullColour.png",
      "../brand/01_Logo/PNG/Founder_Seal/MFB_Founder_Seal_FullColour.png",
    ],
  },
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
