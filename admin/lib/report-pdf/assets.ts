import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import tokens from '../../../brand/mfb-tokens.json';

// Brand assets for the report PDF, read once per server instance. Colours come from the brand token
// file (no hex in code, bundled at build time); fonts are the app's copies of brand/fonts; logos are the
// app's copies of the PNG masters in brand/01_Logo/PNG, kept in assets/report-pdf/ (the PDF renderer
// cannot embed SVG). Both folders are inside the app so next.config.ts can trace them into the
// deployment; files outside the app folder are not traced.

export type BrandColour =
  | 'teal'
  | 'night'
  | 'mist'
  | 'coral'
  | 'coral-deep'
  | 'coral-light'
  | 'cream'
  | 'white'
  | 'sand'
  | 'ink'
  | 'ink-soft'
  | 'ink-muted';

export const colour = Object.fromEntries(tokens.colors.map((c) => [c.token, c.hex])) as Record<BrandColour, string>;

/** The app directory (admin/), from the server's working directory (local dev or a deployment). */
function appDir(): string {
  const cwd = process.cwd();
  return fs.existsSync(path.join(cwd, 'app', 'fonts')) ? cwd : path.join(cwd, 'admin');
}

export interface PdfAssets {
  fonts: Record<string, string>;
  logo: { endorsed: Buffer; horizontal: Buffer; seal: Buffer };
}

let cached: PdfAssets | null = null;

export function pdfAssets(): PdfAssets {
  if (cached) return cached;
  const app = appDir();
  const font = (file: string) => {
    const p = path.join(app, 'app', 'fonts', file);
    if (!fs.existsSync(p)) throw new Error(`Report PDF: font missing at ${p}`);
    return p;
  };
  const png = (name: string) => {
    const p = path.join(app, 'assets', 'report-pdf', `MFB_${name}_FullColour.png`);
    if (!fs.existsSync(p)) throw new Error(`Report PDF: logo missing at ${p}`);
    return fs.readFileSync(p);
  };
  cached = {
    fonts: {
      poppinsRegular: font('Poppins-Regular.ttf'),
      poppinsMedium: font('Poppins-Medium.ttf'),
      poppinsSemiBold: font('Poppins-SemiBold.ttf'),
      poppinsBold: font('Poppins-Bold.ttf'),
      dmSansRegular: font('DMSans-Regular.ttf'),
      dmSansMedium: font('DMSans-Medium.ttf'),
      dmSansBold: font('DMSans-Bold.ttf'),
    },
    logo: {
      endorsed: png('Endorsed_FoundedBy'),
      horizontal: png('Horizontal'),
      seal: png('Founder_Seal'),
    },
  };
  return cached;
}
