"use client";

import { MockBrain } from "./mockBrain";
import type { OnboardingBrain } from "./types";

let instance: OnboardingBrain | null = null;

/** Swap the implementation here when the real backend-backed brain exists. */
export function getBrain(): OnboardingBrain {
  if (!instance) instance = new MockBrain();
  return instance;
}

export type { OnboardingBrain } from "./types";
