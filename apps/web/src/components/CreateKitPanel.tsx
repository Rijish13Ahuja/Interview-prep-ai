"use client";

import { useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import type { KitSummary } from "@/lib/types";

interface BulkRow {
  jd: string;
  company_url: string;
  days: number;
}

interface RowStatus {
  index: number;
  label: string;
  status: "pending" | "submitting" | "done" | "error";
  message?: string;
}

export function CreateKitPanel({ onCreated }: { onCreated: (kit: KitSummary) => void }) {
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [bulkRows, setBulkRows] = useState<RowStatus[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const kit = await api.post<KitSummary>("/api/kits", { jd, company_url: companyUrl, days });
      onCreated(kit);
      setJd("");
      setCompanyUrl("");
      setDays(5);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create kit.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    let rows: BulkRow[];
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("File must contain a JSON array of {jd, company_url, days} objects.");
      rows = parsed.map((r: any, i: number) => {
        if (!r.jd || !r.company_url || !r.days) throw new Error(`Row ${i + 1} is missing jd, company_url, or days.`);
        return { jd: String(r.jd), company_url: String(r.company_url), days: Number(r.days) };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse the uploaded file.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const initialRows: RowStatus[] = rows.map((r, i) => ({ index: i, label: r.company_url, status: "pending" }));
    setBulkRows(initialRows);
    setBulkRunning(true);

    for (let i = 0; i < rows.length; i++) {
      setBulkRows((prev) => prev.map((r) => (r.index === i ? { ...r, status: "submitting" } : r)));
      try {
        const kit = await api.post<KitSummary>("/api/kits", rows[i]);
        onCreated(kit);
        setBulkRows((prev) => prev.map((r) => (r.index === i ? { ...r, status: "done" } : r)));
      } catch (err) {
        setBulkRows((prev) =>
          prev.map((r) => (r.index === i ? { ...r, status: "error", message: err instanceof ApiError ? err.message : "Failed" } : r))
        );
      }
    }
    setBulkRunning(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Create a kit</h2>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div>
          <label htmlFor="jd" className="block text-sm font-medium text-slate-700">
            Job description
          </label>
          <textarea
            id="jd"
            required
            rows={6}
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            placeholder="Paste the full job description here…"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="company_url" className="block text-sm font-medium text-slate-700">
              Company website
            </label>
            <input
              id="company_url"
              type="text"
              required
              value={companyUrl}
              onChange={(e) => setCompanyUrl(e.target.value)}
              placeholder="https://company.example"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="days" className="block text-sm font-medium text-slate-700">
              Days until interview
            </label>
            <input
              id="days"
              type="number"
              min={1}
              max={90}
              required
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {submitting ? "Starting…" : "Generate kit"}
        </button>
      </form>

      <div className="mt-6 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-medium text-slate-700">Prepare for multiple roles at once</h3>
        <p className="mt-1 text-xs text-slate-500">
          Upload a JSON file: an array of <code className="rounded bg-slate-100 px-1">{"{ jd, company_url, days }"}</code> objects.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          disabled={bulkRunning}
          onChange={handleFileSelected}
          className="mt-2 text-sm"
        />

        {bulkRows.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {bulkRows.map((r) => (
              <li key={r.index} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-1.5">
                <span className="truncate text-slate-700">{r.label}</span>
                <span
                  className={
                    r.status === "done"
                      ? "text-green-600"
                      : r.status === "error"
                        ? "text-red-600"
                        : r.status === "submitting"
                          ? "text-indigo-600"
                          : "text-slate-400"
                  }
                >
                  {r.status === "error" ? (r.message ?? "Failed") : r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
