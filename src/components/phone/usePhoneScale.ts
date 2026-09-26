"use client";

import { useEffect, useState } from "react";

export const PHONE_W = 390;
export const PHONE_H = 844;

/** Scale so the whole phone fits the viewport with some breathing room. */
export function usePhoneScale(padding = 48) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () =>
      setScale(Math.min(1, (window.innerHeight - padding) / PHONE_H, (window.innerWidth - padding) / PHONE_W));
    const raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
    };
  }, [padding]);
  return scale;
}
