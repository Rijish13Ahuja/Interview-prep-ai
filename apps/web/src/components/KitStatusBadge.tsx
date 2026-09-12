import type { KitRunStatus } from "@/lib/types";

const STYLES: Record<KitRunStatus, string> = {
  pending: "bg-slate-100 text-slate-600",
  generating: "bg-indigo-100 text-indigo-700",
  ok: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

const LABELS: Record<KitRunStatus, string> = {
  pending: "Pending",
  generating: "Generating…",
  ok: "Ready",
  failed: "Failed",
};

export function KitStatusBadge({ status }: { status: KitRunStatus }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>{LABELS[status]}</span>;
}
