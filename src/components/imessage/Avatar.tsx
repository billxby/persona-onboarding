import { cn } from "@/lib/utils";

/**
 * Persona's real mark (from yourpersona.com): black loop on white. Used for the thread header,
 * contact card, App Clip card and the clip's launch splash. `rounded-full` by default; pass a
 * squarer radius via className where iOS would show an app icon.
 */
export function PersonaAvatar({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-black/[0.08]", className)}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/persona-icon-512.png" alt="Persona" width={size} height={size} className="h-full w-full object-cover" draggable={false} />
    </div>
  );
}
