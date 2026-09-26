"use client";

import { ChevronLeft, ChevronRight, Video } from "lucide-react";
import { PersonaAvatar } from "./Avatar";
import { GLASS } from "./Tapback";

/** iOS 26 Messages header: translucent bar, frosted circular buttons, contact in the middle. */
export function ThreadHeader({ name }: { name: string }) {
  return (
    <div className="absolute inset-x-0 top-0 z-20 border-b border-black/[0.06] bg-white/80 pt-[54px] backdrop-blur-2xl">
      <div className="relative flex h-[66px] items-start justify-between px-3 pt-1">
        <button className={`flex h-[38px] w-[38px] items-center justify-center rounded-full text-imsg-blue ${GLASS}`} aria-label="Back">
          <ChevronLeft className="h-6 w-6 -translate-x-[1px]" strokeWidth={2.4} />
        </button>
        <div className="absolute inset-x-0 top-0 flex flex-col items-center">
          <PersonaAvatar size={44} />
          <div className="mt-0.5 flex items-center text-[12px] leading-none">
            <span>{name}</span>
            <ChevronRight className="h-3 w-3 text-black/40" strokeWidth={2.5} />
          </div>
        </div>
        <button className={`flex h-[38px] w-[38px] items-center justify-center rounded-full text-imsg-blue ${GLASS}`} aria-label="FaceTime">
          <Video className="h-[21px] w-[21px]" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
