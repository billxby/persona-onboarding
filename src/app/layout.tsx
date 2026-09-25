import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Persona onboarding simulator",
  description: "iMessage + call simulator for the Persona onboarding bot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
