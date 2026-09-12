import type { SaveState } from "@/lib/useDebouncedSave";

export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const label = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Failed to save";
  const color = state === "error" ? "text-red-500" : "text-slate-400";
  return <span className={`text-xs ${color}`}>{label}</span>;
}
