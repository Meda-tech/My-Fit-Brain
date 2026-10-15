import Image from 'next/image';
import { cn } from './cn';

export type LogoVariant =
  | 'horizontal'
  | 'horizontal-tagline'
  | 'stacked'
  | 'icon'
  | 'endorsed'
  | 'seal';
export type LogoTone = 'colour' | 'reverse' | 'mono-teal' | 'white';

// Real file names from brand/01_Logo/SVG/. Each app copies only the files it renders
// into public/brand/logo/ — copy the master there before using a new combination.
const LOGO_FILES: Record<LogoVariant, Record<LogoTone, string>> = {
  horizontal: {
    colour: 'MFB_Horizontal_FullColour.svg',
    reverse: 'MFB_Horizontal_Reverse.svg',
    'mono-teal': 'MFB_Horizontal_MonoTeal.svg',
    white: 'MFB_Horizontal_White.svg',
  },
  'horizontal-tagline': {
    colour: 'MFB_Horizontal_Tagline_FullColour.svg',
    reverse: 'MFB_Horizontal_Tagline_Reverse.svg',
    'mono-teal': 'MFB_Horizontal_Tagline_MonoTeal.svg',
    white: 'MFB_Horizontal_Tagline_White.svg',
  },
  stacked: {
    colour: 'MFB_Stacked_FullColour.svg',
    reverse: 'MFB_Stacked_Reverse.svg',
    'mono-teal': 'MFB_Stacked_MonoTeal.svg',
    white: 'MFB_Stacked_White.svg',
  },
  icon: {
    colour: 'MFB_Icon_FullColour.svg',
    reverse: 'MFB_Icon_Reverse.svg',
    'mono-teal': 'MFB_Icon_MonoTeal.svg',
    white: 'MFB_Icon_White.svg',
  },
  endorsed: {
    colour: 'MFB_Endorsed_FoundedBy_FullColour.svg',
    reverse: 'MFB_Endorsed_FoundedBy_Reverse.svg',
    'mono-teal': 'MFB_Endorsed_FoundedBy_MonoTeal.svg',
    white: 'MFB_Endorsed_FoundedBy_White.svg',
  },
  seal: {
    colour: 'MFB_Founder_Seal_FullColour.svg',
    reverse: 'MFB_Founder_Seal_Reverse.svg',
    'mono-teal': 'MFB_Founder_Seal_MonoTeal.svg',
    white: 'MFB_Founder_Seal_White.svg',
  },
};

// viewBox of each master SVG, and the minimum display width from CLAUDE.md.
const LOGO_SPECS: Record<LogoVariant, { w: number; h: number; minWidth: number }> = {
  horizontal: { w: 410.93, h: 153.5, minWidth: 120 },
  'horizontal-tagline': { w: 410.93, h: 153.5, minWidth: 180 },
  stacked: { w: 291.43, h: 226, minWidth: 80 },
  icon: { w: 156, h: 156, minWidth: 16 },
  endorsed: { w: 410.93, h: 153.5, minWidth: 180 },
  seal: { w: 300, h: 300, minWidth: 80 },
};

interface LogoProps {
  variant?: LogoVariant;
  tone?: LogoTone;
  /** Display width in px. Never rendered below the brand minimum for the variant. */
  width?: number;
  priority?: boolean;
  className?: string;
}

export function Logo({
  variant = 'horizontal',
  tone = 'colour',
  width,
  priority = false,
  className,
}: LogoProps) {
  const spec = LOGO_SPECS[variant];
  const displayWidth = Math.max(width ?? spec.minWidth, spec.minWidth);
  const displayHeight = Math.round((displayWidth * spec.h) / spec.w);
  const alt =
    variant === 'endorsed' ? 'My Fit Brain, founded by Dr. Neha Mehta' : 'My Fit Brain';

  return (
    <Image
      src={`/brand/logo/${LOGO_FILES[variant][tone]}`}
      alt={alt}
      width={displayWidth}
      height={displayHeight}
      priority={priority}
      unoptimized
      className={cn('block shrink-0', className)}
      style={{ width: displayWidth, height: displayHeight }}
    />
  );
}
