import { ButtonLink, Card, Footer, Logo } from '../components/brand';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-cream">
      <header className="h-[56px] bg-white border-b border-sand px-4 sm:px-6 flex items-center">
        <Logo variant="horizontal" tone="colour" width={120} priority />
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <Card className="w-full max-w-[460px] p-6 sm:p-8 text-center">
          <h1 className="text-[28px] leading-[1.25] font-semibold text-teal mb-2">
            This page isn&apos;t here
          </h1>
          <p className="text-[16px] text-ink-soft leading-[24px] mb-6">
            The link may be old or mistyped. You can go back to your home screen.
          </p>
          <ButtonLink href="/" variant="primary">
            Go to home
          </ButtonLink>
        </Card>
      </main>

      <Footer />
    </div>
  );
}
