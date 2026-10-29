import Link from 'next/link';
import { BUSINESS, POLICIES_UPDATED } from '../lib/legal';
import { BinduDot, Footer, Logo } from './brand';

// Public policy page shell: plain header, one readable column, footer with every policy link.
// English only; no sign-in and no app navigation, so it reads the same for visitors and clients.
export function LegalPage({
  title,
  intro,
  updated = true,
  children,
}: {
  title: string;
  intro?: React.ReactNode;
  /** Show the "Last updated" line. */
  updated?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div lang="en" className="flex min-h-dvh flex-col bg-cream">
      <header className="sticky top-0 z-20 border-b border-sand bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-240 items-center px-4 sm:px-6">
          <Link href="/" className="flex items-center" aria-label="My Fit Brain home">
            <Logo variant="horizontal" tone="colour" width={120} priority />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-202 flex-1 px-4 pb-12 pt-8 sm:px-6 sm:pt-12">
        <BinduDot className="mb-4" />
        <h1 className="text-[32px] font-semibold leading-[1.2] text-teal sm:text-[40px]">{title}</h1>
        {updated && <p className="mt-2 text-[14px] text-ink-muted">Last updated: {POLICIES_UPDATED}</p>}
        {intro && <div className="mt-5 text-[17px] leading-7 text-ink-soft">{intro}</div>}
        <div className="mt-8 space-y-8">{children}</div>
      </main>

      <Footer className="pb-[max(20px,env(safe-area-inset-bottom))]" />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[22px] font-semibold leading-[1.3] text-teal sm:text-[24px]">{title}</h2>
      <div className="mt-3 space-y-3 text-[16px] leading-6.5 text-ink-soft [&_a]:font-medium [&_a]:text-teal [&_a]:underline [&_a]:underline-offset-2 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

/** Email, phone and address, reused at the end of each policy. */
export function ContactLines() {
  return (
    <ul>
      <li>
        Email: <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
      </li>
      <li>
        Phone: <a href={BUSINESS.phoneHref}>{BUSINESS.phoneDisplay}</a>
      </li>
      <li>Address: {BUSINESS.address}</li>
    </ul>
  );
}
