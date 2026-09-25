import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function PersonaAvatar({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full bg-gradient-to-br from-[#8e8e93] to-[#636366] text-white shadow-inner",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Sparkles style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2} />
    </div>
  );
}
