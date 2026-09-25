"use client";

import { Check, Circle, Clock, Minus, X } from "lucide-react";
import { SLOT_LABELS, SLOT_ORDER, type Slot, type SlotKey, type Slots } from "@/lib/session/types";
import { cn } from "@/lib/utils";

/** The four progress chips: You · Your need · Gmail · My name. Never a form. */
export function SlotChips({ slots, onClick }: { slots: Slots; onClick?: (key: SlotKey) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SLOT_ORDER.map((key) => (
        <Chip key={key} slotKey={key} slot={slots[key]} onClick={onClick ? () => onClick(key) : undefined} />
      ))}
    </div>
  );
}

function Chip({ slotKey, slot, onClick }: { slotKey: SlotKey; slot: Slot; onClick?: () => void }) {
  const styles: Record<Slot["status"], string> = {
    empty: "border-black/15 bg-white text-black/55",
    pending: "border-amber-300 bg-amber-50 text-amber-800",
    filled: "border-emerald-300 bg-emerald-50 text-emerald-800",
    skipped: "border-black/10 bg-black/5 text-black/45 line-through",
    declined: "border-rose-200 bg-rose-50 text-rose-700",
    failed: "border-rose-300 bg-rose-50 text-rose-800",
  };
  const Icon = { empty: Circle, pending: Clock, filled: Check, skipped: Minus, declined: X, failed: X }[slot.status];
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition",
        styles[slot.status],
        onClick && "hover:brightness-95",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      <span className="font-medium">{SLOT_LABELS[slotKey]}</span>
      {slot.value && <span className="text-black/60">· {slot.value}</span>}
    </button>
  );
}
