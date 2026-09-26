"use client";

import { useCallback, useRef } from "react";

/**
 * iMessage-style triggers for the tapback/menu overlay:
 *   long press (380ms), double tap, or right-click on desktop.
 * Movement beyond a few px cancels the press so the thread can still be dragged.
 */
export function useLongPress(onTrigger: () => void, { delay = 380 }: { delay?: number } = {}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        onTrigger();
        clear();
      }, delay);
    },
    [onTrigger, delay, clear],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return;
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 6) clear();
    },
    [clear],
  );

  const onPointerUp = useCallback(() => clear(), [clear]);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (fired.current) {
        e.preventDefault();
        return;
      }
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        onTrigger();
      } else {
        lastTap.current = now;
      }
    },
    [onTrigger],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onTrigger();
    },
    [onTrigger],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onPointerLeave: onPointerUp, onPointerCancel: onPointerUp, onClick, onContextMenu };
}
