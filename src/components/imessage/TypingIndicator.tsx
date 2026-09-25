"use client";

import { motion } from "motion/react";

export function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8 }}
      className="bubble bubble-in tail flex items-center gap-1 px-3.5 py-3"
      aria-label="Persona is typing"
    >
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </motion.div>
  );
}
