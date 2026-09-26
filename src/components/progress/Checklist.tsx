"use client";

import { Check } from "lucide-react";
import { motion } from "motion/react";
import { useHydrated } from "@/components/Simulator";
import { useSessionStore } from "@/lib/session/store";
import { SLOT_LABELS, SLOT_ORDER, type Slot, type SlotKey } from "@/lib/session/types";
import { cn } from "@/lib/utils";
import { editSlot } from "./slotEdit";

/**
 * Onboarding checklist, right of the phone (DESIGN §15.3): the four slots as
 * done / not done, labels only. Values live in the brain view. A row tap opens
 * the matching edit (prompt / connect page), never a form in the thread.
 */
export function Checklist() {
  const hydrated = useHydrated();
  const slots = useSessionStore((s) => s.slots);
  if (!hydrated) return null;
  return (
    <ul className="fixed right-5 top-1/2 z-40 hidden w-[164px] -translate-y-1/2 flex-col gap-0.5 rounded-2xl border border-line bg-panel/85 p-1.5 text-ink shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl md:flex">
      {SLOT_ORDER.map((key) => (
        <Row key={key} slotKey={key} slot={slots[key]} />
      ))}
    </ul>
  );
}

function Row({ slotKey, slot }: { slotKey: SlotKey; slot: Slot }) {
  const done = slot.status === "filled";
  const dropped = slot.status === "skipped" || slot.status === "declined";
  return (
    <li>
      <button
        onClick={() => void editSlot(slotKey)}
        title={`Edit ${SLOT_LABELS[slotKey].toLowerCase()}`}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[13px] transition hover:bg-ink/5"
      >
        <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors", done ? "border-ink bg-ink text-panel" : "border-ink/25")}>
          {done && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} className="flex">
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </motion.span>
          )}
        </span>
        <span className={cn("truncate", done ? "font-medium" : "text-ink/55", dropped && "line-through")}>{SLOT_LABELS[slotKey]}</span>
      </button>
    </li>
  );
}
