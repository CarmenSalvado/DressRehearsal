import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Cormorant_Garamond, DM_Sans } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
});

const body = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
});

const wordmark = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-wordmark",
  weight: "500",
});

export const metadata: Metadata = {
  title: "Dress Rehearsal - Try It Before They Make It",
  description:
    "Try unreleased fashion samples, pick your favorite and help brands make smarter inventory decisions.",
};

export const viewport: Viewport = {
  themeColor: "#f4f0e7",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${wordmark.variable}`}>{children}</body>
    </html>
  );
}
