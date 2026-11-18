import { useRef } from "react";

/** Recognize two quick clicks or taps without relying on mobile dblclick events. */
export function useDoubleTap(action: () => void, single?: () => void) {
  const lastTap = useRef<number | null>(null);
  return () => {
    single?.();
    const now = Date.now();
    if (lastTap.current !== null && now - lastTap.current < 350) {
      lastTap.current = null;
      action();
    } else {
      lastTap.current = now;
    }
  };
}