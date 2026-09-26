import type { Tapback } from "@/lib/session/types";

/**
 * iOS 18+ tapbacks are full-colour glyphs on a neutral frosted badge.
 * Palette lives here so it can be tuned in one place.
 */
export const TAPBACK_COLOR: Record<Tapback, string> = {
  heart: "#FF2D55",
  thumbsUp: "#3B82F6",
  thumbsDown: "#FF7A1A",
  haha: "#F5A300",
  exclaim: "#F5A300",
  question: "#AF52DE",
};

export const TAPBACK_LABEL: Record<Tapback, string> = {
  heart: "Love",
  thumbsUp: "Like",
  thumbsDown: "Dislike",
  haha: "Laugh",
  exclaim: "Emphasize",
  question: "Question",
};
