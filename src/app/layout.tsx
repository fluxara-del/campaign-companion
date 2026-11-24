import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kronike Devet Zvona — Campaign Companion",
  description: "Privatni pratitelj kampanje: lik, dnevnik i AI Dungeon Master.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="hr">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
