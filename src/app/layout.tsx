import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

/**
 * Display face for the App Clip's onboarding headlines (DESIGN §19). Self-hosted by next/font; the
 * variable is read by `--font-display` in globals.css. Body text everywhere stays the system stack,
 * so the clip matches iOS (and the native clip) while the headlines carry the brand.
 */
const display = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-clip-display", display: "swap" });

export const metadata: Metadata = {
  title: "Persona onboarding simulator",
  description: "iMessage + call simulator for the Persona onboarding bot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes sets data-theme on <html> before paint; the attribute is not in the server HTML.
    <html lang="en" suppressHydrationWarning className={display.variable}>
      <body className="min-h-full antialiased">
        <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
