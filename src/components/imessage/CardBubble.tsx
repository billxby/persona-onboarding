"use client";

import { Check } from "lucide-react";
import type { MessageCard } from "@/lib/session/types";
import { cn } from "@/lib/utils";
import { PersonaAvatar } from "./Avatar";

/** Rich card in the thread (like an iMessage app card). */
export function CardBubble({
  card,
  messageId,
  onAction,
  className,
}: {
  card: MessageCard;
  messageId: string;
  onAction: (actionId: string, messageId: string) => void;
  className?: string;
}) {
  const taken = card.takenActionId;
  return (
    <div className={cn("w-[78%] overflow-hidden rounded-[18px] border border-black/10 bg-white shadow-sm", className)}>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <PersonaAvatar size={34} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{card.title}</div>
          {card.subtitle && <div className="truncate text-[12px] text-black/55">{card.subtitle}</div>}
        </div>
      </div>
      <div className="divide-y divide-black/10 border-t border-black/10">
        {card.actions.map((a) => {
          const isTaken = taken === a.id;
          return (
            <button
              key={a.id}
              disabled={!!taken}
              onClick={() => onAction(a.id, messageId)}
              className={cn(
                "flex w-full items-center justify-center gap-1.5 px-3 py-2.5 text-[15px] transition active:bg-black/5 disabled:cursor-default",
                a.variant === "primary" ? "font-semibold text-imsg-blue" : "text-imsg-blue",
                a.variant === "destructive" && "text-ios-red",
                taken && !isTaken && "text-black/30",
              )}
            >
              {isTaken && <Check className="h-4 w-4" strokeWidth={3} />}
              {a.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
