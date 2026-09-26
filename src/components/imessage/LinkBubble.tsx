"use client";

import { Link2, Mail } from "lucide-react";
import type { LinkPreview } from "@/lib/session/types";
import { cn } from "@/lib/utils";
import { PersonaAvatar } from "./Avatar";

/**
 * A standalone URL in iMessage renders as a rich link preview: image (or site
 * icon), title, domain. If the page advertises an App Clip AND the sender is in
 * the recipient's Contacts, iOS shows the App Clip bubble instead, with the app
 * icon and an Open button. Otherwise it falls back to the plain preview.
 */
export function LinkBubble({
  link,
  senderInContacts,
  onOpen,
  onOpenAppClip,
  className,
}: {
  link: LinkPreview;
  senderInContacts: boolean;
  onOpen: () => void;
  onOpenAppClip: () => void;
  className?: string;
}) {
  const showAppClip = !!link.appClip && senderInContacts;

  if (showAppClip && link.appClip) {
    const clip = link.appClip;
    return (
      <div className={cn("w-[284px] max-w-full overflow-hidden rounded-[18px] bg-imsg-gray", className)}>
        <PreviewImage link={link} tall />
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <PersonaAvatar size={38} className="rounded-[10px]" />
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[14px] font-semibold leading-[17px]">{clip.title}</div>
            <div className="truncate text-[12px] leading-tight text-screen-ink/55">{clip.subtitle}</div>
          </div>
          <button
            onClick={onOpenAppClip}
            className="shrink-0 rounded-full bg-imsg-blue px-3.5 py-[6px] text-[13px] font-semibold text-white active:opacity-80"
          >
            {clip.verb ?? "Open"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button onClick={onOpen} className={cn("w-[284px] max-w-full overflow-hidden rounded-[18px] bg-imsg-gray text-left active:opacity-80", className)}>
      {link.imageUrl || link.appClip ? <PreviewImage link={link} /> : null}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {!link.imageUrl && !link.appClip && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-screen-ink/[0.06] text-screen-ink/50">
            <Link2 className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          {link.title && <div className="line-clamp-2 text-[15px] font-semibold leading-tight">{link.title}</div>}
          <div className="truncate text-[13px] leading-tight text-screen-ink/55">{link.domain}</div>
        </div>
      </div>
    </button>
  );
}

/** OG image or a generated placeholder (we don't ship brand art). */
function PreviewImage({ link, tall }: { link: LinkPreview; tall?: boolean }) {
  if (link.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={link.imageUrl} alt="" className={cn("w-full object-cover", tall ? "h-[150px]" : "h-[130px]")} />;
  }
  return (
    <div className={cn("flex w-full items-center justify-center bg-gradient-to-br from-[#e6e6ec] via-[#f3f3f7] to-[#d9d9e0] dark:from-[#2c2c2e] dark:via-[#3a3a3c] dark:to-[#1c1c1e]", tall ? "h-[150px]" : "h-[130px]")}>
      <div className="flex items-center gap-3 text-screen-ink/60">
        <PersonaAvatar size={44} />
        {link.appClip && (
          <>
            <span className="text-[20px] text-screen-ink/30">+</span>
            <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-white shadow-sm">
              <Mail className="h-5 w-5 text-[#ea4335]" />
            </span>
          </>
        )}
      </div>
    </div>
  );
}
