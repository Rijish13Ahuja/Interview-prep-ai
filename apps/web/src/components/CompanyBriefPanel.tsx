"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useDebouncedSave } from "@/lib/useDebouncedSave";
import { SaveIndicator } from "./SaveIndicator";
import type { Kit, KitDetail } from "@/lib/types";

const DISCUSSION_LABELS: Record<string, string> = {
  found: "Public discussion of the interview process was found and folded into the summary below.",
  no_results: "We looked for public discussion of the interview process but found none.",
  search_failed: "The discussion search failed and was skipped — this does not affect the rest of the kit.",
  not_configured: "Public discussion research was not configured for this kit.",
};

export function CompanyBriefPanel({ kitId, kit, companyBriefLocked, onUpdated }: { kitId: string; kit: Kit; companyBriefLocked: boolean; onUpdated: (kit: KitDetail) => void }) {
  const [regenerating, setRegenerating] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summary = useDebouncedSave(kit.company_brief.summary, async (value) => {
    const updated = await api.patch<KitDetail>(`/api/kits/${kitId}/company-brief`, { summary: value });
    onUpdated(updated);
  });
  const whatTheyDo = useDebouncedSave(kit.company_brief.what_they_do, async (value) => {
    const updated = await api.patch<KitDetail>(`/api/kits/${kitId}/company-brief`, { what_they_do: value });
    onUpdated(updated);
  });

  async function handleRegenerate(force: boolean) {
    setError(null);
    setRegenerating(true);
    try {
      const updated = await api.post<KitDetail>(`/api/kits/${kitId}/regenerate/company-brief`, { force });
      onUpdated(updated);
      setConfirmForce(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "COMPANY_BRIEF_LOCKED") {
        setConfirmForce(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to regenerate.");
      }
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Company brief</h2>
        <div className="flex items-center gap-2">
          {companyBriefLocked && <span className="text-xs text-amber-600">Manually edited</span>}
          <button
            type="button"
            disabled={regenerating}
            onClick={() => handleRegenerate(false)}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      </div>

      {confirmForce && (
        <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          <p>This brief has manual edits. Regenerating will discard them.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => handleRegenerate(true)} className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500">
              Discard edits and regenerate
            </button>
            <button type="button" onClick={() => setConfirmForce(false)} className="rounded-md border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 space-y-4">
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700">Summary</label>
            <SaveIndicator state={summary.state} />
          </div>
          <textarea
            rows={4}
            value={summary.value}
            onChange={(e) => summary.update(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700">What they do</label>
            <SaveIndicator state={whatTheyDo.state} />
          </div>
          <textarea
            rows={2}
            value={whatTheyDo.value}
            onChange={(e) => whatTheyDo.update(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <p className="text-xs text-slate-500">{DISCUSSION_LABELS[kit.company_brief.discussion_status] ?? ""}</p>

        {kit.source.pages_used.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-500">Sources</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {kit.source.pages_used.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
