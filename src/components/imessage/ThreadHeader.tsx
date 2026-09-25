"use client";

import { ChevronLeft, ChevronRight, Video } from "lucide-react";
import { PersonaAvatar } from "./Avatar";

export function ThreadHeader({ name }: { name: string }) {
  return (
    <div className="absolute inset-x-0 top-0 z-20 border-b border-black/10 bg-white/80 pt-[54px] backdrop-blur-xl">
      <div className="relative flex h-[62px] items-end justify-between px-2 pb-1">
        <button className="flex items-center text-imsg-blue" aria-label="Back">
          <ChevronLeft className="h-7 w-7" strokeWidth={2.2} />
        </button>
        <div className="absolute inset-x-0 bottom-1 flex flex-col items-center">
          <PersonaAvatar size={44} />
          <div className="mt-0.5 flex items-center text-[12px] leading-none">
            <span>{name}</span>
            <ChevronRight className="h-3 w-3 text-black/40" strokeWidth={2.5} />
          </div>
        </div>
        <button className="flex items-center pr-2 text-imsg-blue" aria-label="FaceTime">
          <Video className="h-6 w-6" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
