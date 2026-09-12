import type { Kit } from "@/lib/types";

const PRIORITY_STYLES: Record<string, string> = {
  must: "bg-red-50 text-red-700 border-red-200",
  nice: "bg-slate-50 text-slate-600 border-slate-200",
};

export function RequirementsPanel({ kit }: { kit: Kit }) {
  const uncovered = new Set(kit.coverage.uncovered_requirement_ids);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Role & requirements</h2>
        <span className="text-xs text-slate-500">{kit.coverage.passes} generation pass{kit.coverage.passes === 1 ? "" : "es"}</span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {kit.role.title} · {kit.role.seniority}
        {kit.source.location ? ` · ${kit.source.location}` : ""}
      </p>

      {kit.role.responsibilities.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-slate-600">
          {kit.role.responsibilities.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      {kit.role.requirements.length === 0 ? (
        <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          No specific requirements could be extracted from the job description provided.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {kit.role.requirements.map((r) => (
            <li key={r.id} className="flex items-start gap-2 rounded-md border border-slate-100 px-3 py-2 text-sm">
              <span className={`mt-0.5 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${PRIORITY_STYLES[r.priority]}`}>
                {r.priority}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-slate-800">{r.text}</p>
                <p className="text-xs text-slate-400">{r.kind}</p>
              </div>
              {uncovered.has(r.id) && (
                <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  No question yet
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
