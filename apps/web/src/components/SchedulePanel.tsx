"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { KitDetail } from "@/lib/types";

export function SchedulePanel({ kitId, detail, onUpdated }: { kitId: string; detail: KitDetail; onUpdated: (kit: KitDetail) => void }) {
  const kit = detail.kit!;
  const [regenerating, setRegenerating] = useState(false);
  const questionById = new Map(kit.questions.map((q) => [q.id, q]));

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const updated = await api.post<KitDetail>(`/api/kits/${kitId}/regenerate/schedule`);
      onUpdated(updated);
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Study schedule</h2>
        <button
          type="button"
          disabled={regenerating}
          onClick={handleRegenerate}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {regenerating ? "Regenerating…" : "Regenerate schedule"}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">{kit.schedule.days_available} day(s) until the interview.</p>

      <ol className="mt-4 space-y-3">
        {kit.schedule.days.map((day) => (
          <li key={day.day} className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-slate-900">
                Day {day.day} — {day.focus}
              </p>
              <span className="text-xs text-slate-500">{day.minutes} min</span>
            </div>
            {day.question_ids.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-slate-600">
                {day.question_ids.map((id) => {
                  const q = questionById.get(id);
                  return <li key={id}>{q ? q.prompt : id}</li>;
                })}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
