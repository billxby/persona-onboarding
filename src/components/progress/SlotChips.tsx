"use client";

import { Check, Circle, Clock, Minus, X } from "lucide-react";
import { SLOT_LABELS, SLOT_ORDER, type Slot, type SlotKey, type Slots } from "@/lib/session/types";
import { cn } from "@/lib/utils";
import { editSlot } from "./slotEdit";

/**
 * The four progress chips: You · Your need · Gmail · My name. Never a form.
 * `editable` makes a chip tap open the matching edit (prompt / connect page).
 */
export function SlotChips({ slots, onClick, editable, compact }: { slots: Slots; onClick?: (key: SlotKey) => void; editable?: boolean; compact?: boolean }) {
  const handler = onClick ?? (editable ? (key: SlotKey) => void editSlot(key) : undefined);
  return (
    <div className={cn("flex flex-wrap gap-2", compact && "gap-1.5")}>
      {SLOT_ORDER.map((key) => (
        <Chip key={key} slotKey={key} slot={slots[key]} compact={compact} onClick={handler ? () => handler(key) : undefined} />
      ))}
    </div>
  );
}

function Chip({ slotKey, slot, onClick, compact }: { slotKey: SlotKey; slot: Slot; onClick?: () => void; compact?: boolean }) {
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
      title={onClick ? `Edit ${SLOT_LABELS[slotKey].toLowerCase()}` : undefined}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition",
        compact && "px-2.5 py-0.5 text-[12px]",
        styles[slot.status],
        onClick && "hover:brightness-95",
        !onClick && "cursor-default",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      <span className="font-medium">{SLOT_LABELS[slotKey]}</span>
      {slot.value && <span className="max-w-[140px] truncate text-black/60">· {slot.value}</span>}
    </button>
  );
}
