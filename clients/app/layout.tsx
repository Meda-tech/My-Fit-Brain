import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { poppins, dmSans } from "./fonts";
import { ServiceWorkerRegister } from "../components/ServiceWorkerRegister";
import { LanguageProvider } from "../components/LanguageProvider";
import { LANG_COOKIE, parseLang } from "../lib/lang-cookie";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Fit Brain",
  description: "Private, structured assessments with qualified counsellors.",
  applicationName: "My Fit Brain",
  appleWebApp: {
    capable: true,
    title: "My Fit Brain",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/android-chrome-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#145A5A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialLang = parseLang((await cookies()).get(LANG_COOKIE)?.value);

  return (
    <html lang={initialLang} className={`${poppins.variable} ${dmSans.variable}`}>
      <body className="min-h-screen antialiased bg-cream text-ink font-body">
        <LanguageProvider initialLang={initialLang}>{children}</LanguageProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
