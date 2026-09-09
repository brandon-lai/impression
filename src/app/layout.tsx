import type { Metadata, Viewport } from "next";
import { Newsreader, Instrument_Sans } from "next/font/google";
import "./globals.css";

const title = Newsreader({
  subsets: ["latin"],
  style: ["italic", "normal"],
  variable: "--font-title",
  display: "swap",
});

const ui = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Impression",
  description: "Turn your voice into an impressionist painting.",
};

export const viewport: Viewport = {
  themeColor: "#f7f5f0",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${title.variable} ${ui.variable}`}>
      <body>{children}</body>
    </html>
  );
}
