"use client";

import { MockBrain } from "./mockBrain";
import { ServerBrain } from "./serverBrain";
import type { OnboardingBrain } from "./types";

let instance: OnboardingBrain | null = null;

/** The backend-backed brain, or the canned mock with NEXT_PUBLIC_BRAIN=mock (UI-only mode). */
export function getBrain(): OnboardingBrain {
  if (!instance) instance = process.env.NEXT_PUBLIC_BRAIN === "mock" ? new MockBrain() : new ServerBrain();
  return instance;
}

export type { OnboardingBrain } from "./types";
