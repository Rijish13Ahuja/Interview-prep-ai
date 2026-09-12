import { GENERATION_STEP_LABELS, type KitDetail } from "@/lib/types";

const STEP_ORDER = Object.keys(GENERATION_STEP_LABELS);

export function GenerationProgress({ detail }: { detail: KitDetail }) {
  if (detail.status === "failed") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <h2 className="font-semibold text-red-800">Generation failed</h2>
        <p className="mt-1 text-sm text-red-700">{detail.error?.message ?? "An unexpected error occurred."}</p>
        <p className="mt-2 text-xs text-red-500">Error code: {detail.error?.code}</p>
      </div>
    );
  }

  const currentIndex = detail.step ? STEP_ORDER.indexOf(detail.step) : -1;

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-6">
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-indigo-600" />
        <h2 className="font-semibold text-indigo-900">Generating your kit…</h2>
      </div>
      <p className="mt-1 text-sm text-indigo-700">{detail.step ? GENERATION_STEP_LABELS[detail.step] : "Starting up"}…</p>
      <ol className="mt-4 space-y-1">
        {STEP_ORDER.map((step, i) => (
          <li key={step} className={`text-xs ${i < currentIndex ? "text-indigo-400 line-through" : i === currentIndex ? "font-medium text-indigo-800" : "text-indigo-300"}`}>
            {GENERATION_STEP_LABELS[step]}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-indigo-500">This can take up to a couple of minutes — this page updates automatically.</p>
    </div>
  );
}
