"use client";

import { ChevronLeft, ChevronRight, Phone, User, Video } from "lucide-react";
import { callController } from "@/lib/call/controller";
import { session } from "@/lib/session/store";
import { PersonaAvatar } from "./Avatar";
import { GLASS } from "./Tapback";

/** Tap the phone icon: Persona rings you back 1–2 s later (DESIGN §7.2). */
function requestCall() {
  const s = session.get();
  if (s.call.state === "ringing" || s.call.state === "connecting" || s.call.state === "live") return;
  s.logEvent("user.call_request");
  setTimeout(() => callController.ring(), 1000 + Math.random() * 1000);
}

/** iOS 26 Messages header: translucent bar, frosted circular buttons, contact in the middle. */
export function ThreadHeader({ name, known = true }: { name: string; known?: boolean }) {
  return (
    <div className="absolute inset-x-0 top-0 z-20 border-b border-screen-ink/[0.06] bg-screen/80 pt-[54px] backdrop-blur-2xl">
      <div className="relative flex h-[66px] items-start justify-between px-3 pt-1">
        <button className={`flex h-[38px] w-[38px] items-center justify-center rounded-full text-imsg-blue ${GLASS}`} aria-label="Back">
          <ChevronLeft className="h-6 w-6 -translate-x-[1px]" strokeWidth={2.4} />
        </button>
        <div className="absolute inset-x-0 top-0 flex flex-col items-center">
          {known ? (
            <PersonaAvatar size={44} />
          ) : (
            // an unknown sender: iOS's grey silhouette, no photo, the number underneath
            <span className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-[#b8b8bd] text-white dark:bg-[#636366]" aria-hidden>
              <User className="h-[26px] w-[26px] translate-y-[3px]" strokeWidth={1.8} fill="currentColor" />
            </span>
          )}
          <div className="mt-0.5 flex items-center text-[12px] leading-none">
            <span>{name}</span>
            <ChevronRight className="h-3 w-3 text-screen-ink/40" strokeWidth={2.5} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={requestCall} className={`flex h-[38px] w-[38px] items-center justify-center rounded-full text-imsg-blue ${GLASS}`} aria-label="Call">
            <Phone className="h-[19px] w-[19px]" strokeWidth={2} />
          </button>
          <button className={`flex h-[38px] w-[38px] items-center justify-center rounded-full text-imsg-blue ${GLASS}`} aria-label="FaceTime">
            <Video className="h-[21px] w-[21px]" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
