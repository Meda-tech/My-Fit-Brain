import { Pill } from '../../../components/brand';

// Small shared pieces for the version tabs.

export function JsonDetails({ value, label = 'Raw JSON' }: { value: unknown; label?: string }) {
  return (
    <details className="mt-2 text-[13px]">
      <summary className="inline-flex min-h-[32px] cursor-pointer items-center text-teal hover:underline">{label}</summary>
      <pre className="mt-1 max-h-[360px] overflow-auto rounded-input border border-sand bg-cream p-3 font-mono text-[12px] leading-[18px] text-ink-soft">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h3 className="mb-3 flex items-center gap-2 text-[18px] font-semibold text-teal">
        {title}
        {count !== undefined && <Pill tone="quiet">{count}</Pill>}
      </h3>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] text-ink-muted">{children}</p>;
}

export function BiText({ en, hi }: { en: React.ReactNode; hi: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
      <p lang="en" className="text-[15px] leading-[23px] text-ink">{en}</p>
      <p lang="hi" className="text-[15px] leading-[23px] text-ink-soft">{hi}</p>
    </div>
  );
}
