import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import tokens from '../../../brand/mfb-tokens.json';

// Brand assets for the report PDF, read once per server instance. Colours come from the brand token
// file (no hex in code); fonts are the app's copies of brand/fonts; logos are the PNG masters in
// brand/01_Logo/PNG (the PDF renderer cannot embed SVG). next.config.ts traces these files into the
// deployment of the PDF route.

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

/** The app directory (admin/) and the repository root, from the server's working directory. */
function roots() {
  const cwd = process.cwd();
  const app = fs.existsSync(path.join(cwd, 'app', 'fonts')) ? cwd : path.join(cwd, 'admin');
  return { app, repo: path.join(app, '..') };
}

export interface PdfAssets {
  fonts: Record<string, string>;
  logo: { endorsed: Buffer; horizontal: Buffer; seal: Buffer };
}

let cached: PdfAssets | null = null;

export function pdfAssets(): PdfAssets {
  if (cached) return cached;
  const { app, repo } = roots();
  const font = (file: string) => path.join(app, 'app', 'fonts', file);
  const png = (folder: string, name: string) =>
    fs.readFileSync(path.join(repo, 'brand', '01_Logo', 'PNG', folder, `MFB_${name}_FullColour.png`));
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
      endorsed: png('Endorsed_FoundedBy', 'Endorsed_FoundedBy'),
      horizontal: png('Horizontal', 'Horizontal'),
      seal: png('Founder_Seal', 'Founder_Seal'),
    },
  };
  return cached;
}
