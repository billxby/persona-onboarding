"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

/** Light / dark for the stage chrome. The phone keeps its own appearance. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label="Toggle light or dark mode"
      className="fixed right-5 top-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-panel/90 text-ink/70 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:bg-panel"
    >
      {/* both rendered; CSS picks one, so there is nothing to get wrong at hydration */}
      <Sun className="h-5 w-5 dark:hidden" />
      <Moon className="hidden h-5 w-5 dark:block" />
    </button>
  );
}
