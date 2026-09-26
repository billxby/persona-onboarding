import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "Persona onboarding simulator",
  description: "iMessage + call simulator for the Persona onboarding bot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes sets data-theme on <html> before paint; the attribute is not in the server HTML.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-full antialiased">
        <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
