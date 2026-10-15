import { Lock, ShieldCheck, Users } from 'lucide-react';
import { Footer, Logo } from './brand';

const POINTS = [
  { icon: Users, text: 'Client records linked to verified phone numbers' },
  { icon: ShieldCheck, text: 'Separate access for admins, coordinators and counsellors' },
  { icon: Lock, text: 'Client information stays private' },
];

// Split layout for signed-out staff screens: brand panel (desktop) + form column.
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-cream lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-night text-white lg:flex lg:flex-col lg:justify-between lg:gap-12 lg:p-12 xl:p-16">
        {/* Icon watermark, cropped at the corner */}
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-24 opacity-[0.08]">
          <Logo variant="icon" tone="white" width={420} />
        </div>

        <Logo variant="horizontal" tone="reverse" width={160} priority />

        <div className="relative max-w-[440px]">
          <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-mist">Staff portal</p>
          <h2 className="mt-3 text-[40px] font-semibold leading-[1.15] text-coral-light xl:text-[48px]">
            Space to speak.
          </h2>
          <p className="mt-4 text-[17px] leading-[27px] text-mist">
            Manage client records and coordinators for MFB Assessments, in one calm place.
          </p>

          <ul className="mt-8 space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[15px] text-white">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-mist">
                  <Icon size={18} strokeWidth={2} aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[14px] text-mist">Assessments designed by Dr. Neha Mehta</p>
      </aside>

      {/* Form column */}
      <div className="flex min-h-screen flex-col">
        <div className="flex h-16 items-center px-5 sm:px-8 lg:hidden">
          <Logo variant="horizontal" tone="colour" width={130} priority />
        </div>

        <main className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8">
          <div className="w-full max-w-[420px]">{children}</div>
        </main>

        <Footer bordered={false} />
      </div>
    </div>
  );
}
