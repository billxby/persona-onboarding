"use client";

import { cn } from "@/lib/utils";
import { StatusBar } from "./StatusBar";

/**
 * iPhone-shaped shell. Purely presentational; anything passed as children
 * renders as "the screen".
 */
export function PhoneFrame({
  children,
  dark = false,
  className,
}: {
  children: React.ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative h-[844px] w-[390px] shrink-0 rounded-[58px] bg-[#0b0b0c] p-[11px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55),inset_0_0_0_2px_#3a3a3c]",
        className,
      )}
    >
      {/* side buttons */}
      <div className="absolute -left-[3px] top-[130px] h-[32px] w-[3px] rounded-l bg-[#2c2c2e]" />
      <div className="absolute -left-[3px] top-[190px] h-[62px] w-[3px] rounded-l bg-[#2c2c2e]" />
      <div className="absolute -left-[3px] top-[265px] h-[62px] w-[3px] rounded-l bg-[#2c2c2e]" />
      <div className="absolute -right-[3px] top-[210px] h-[96px] w-[3px] rounded-r bg-[#2c2c2e]" />

      {/* the screen follows the app theme through the screen tokens; `dark` (call screens) forces iOS dark */}
      <div
        className="relative h-full w-full overflow-hidden rounded-[47px] bg-screen text-screen-ink"
        style={dark ? ({ "--screen-bg": "#000", "--screen-ink": "#fff" } as React.CSSProperties) : undefined}
      >
        <StatusBar />
        {/* dynamic island */}
        <div className="pointer-events-none absolute left-1/2 top-[11px] z-40 h-[35px] w-[124px] -translate-x-1/2 rounded-full bg-black" />
        {children}
        {/* home indicator */}
        <div
          className="pointer-events-none absolute bottom-2 left-1/2 z-40 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-screen-ink/90"
        />
      </div>
    </div>
  );
}
