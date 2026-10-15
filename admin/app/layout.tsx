import type { Metadata, Viewport } from "next";
import { poppins, dmSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Fit Brain · Staff",
  description: "Staff portal for My Fit Brain assessments.",
  manifest: "/manifest.webmanifest",
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${poppins.variable} ${dmSans.variable}`}>
      <body className="min-h-screen antialiased bg-cream text-ink font-body">
        {children}
      </body>
    </html>
  );
}
