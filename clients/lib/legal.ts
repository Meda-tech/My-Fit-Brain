// Business details and links for the public policy pages (terms, privacy, refunds, contact, pricing).
// These pages are open without sign-in (proxy.ts) so the payment gateway and visitors can read them.

export const BUSINESS = {
  brand: 'My Fit Brain',
  legalName: 'MeDa Partners Pvt Ltd',
  address: 'Opp Civil Hospital, Sirsa Rd, Hisar, Haryana 125001',
  email: 'help@myfitbrain.in',
  phoneDisplay: '+91 90502 32637',
  phoneHref: 'tel:+919050232637',
} as const;

/** Shown on every policy page as "Last updated". */
export const POLICIES_UPDATED = '29 October 2026';

export const POLICY_LINKS = [
  { href: '/pricing', label: 'Pricing & Services' },
  { href: '/terms', label: 'Terms & Conditions' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/refund-policy', label: 'Refund & Cancellation' },
  { href: '/contact', label: 'Contact Us' },
] as const;

/** Paths that need no sign-in. */
export const PUBLIC_PATHS: readonly string[] = POLICY_LINKS.map((link) => link.href);
