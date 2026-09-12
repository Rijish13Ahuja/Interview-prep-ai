"use client";

import { useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Local edits feel immediate — value updates instantly in the input. The
 * actual PATCH request fires ~800ms after the user stops typing, not on
 * every keystroke.
 */
export function useDebouncedSave<T>(initialValue: T, onSave: (value: T) => Promise<void>, delayMs = 800) {
  const [value, setValue] = useState(initialValue);
  const [state, setState] = useState<SaveState>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef(initialValue);

  useEffect(() => {
    setValue(initialValue);
    latestValueRef.current = initialValue;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue]);

  function update(next: T) {
    setValue(next);
    latestValueRef.current = next;
    setState("saving");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      try {
        await onSave(latestValueRef.current);
        setState("saved");
        setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
      } catch {
        setState("error");
      }
    }, delayMs);
  }

  return { value, update, state };
}
