"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/useSession";
import { api } from "@/lib/api";
import type { KitSummary } from "@/lib/types";
import { Nav } from "@/components/Nav";
import { CreateKitPanel } from "@/components/CreateKitPanel";
import { KitStatusBadge } from "@/components/KitStatusBadge";
import { GENERATION_STEP_LABELS } from "@/lib/types";

export default function DashboardPage() {
  const { user, loading } = useSession();
  const [kits, setKits] = useState<KitSummary[]>([]);
  const [loadingKits, setLoadingKits] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { kits } = await api.get<{ kits: KitSummary[] }>("/api/kits");
      setKits(kits);
    } finally {
      setLoadingKits(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    refresh();
  }, [user, refresh]);

  // Poll while any kit is still generating — this is what surfaces "visible progress" on the dashboard.
  useEffect(() => {
    const anyInFlight = kits.some((k) => k.status === "pending" || k.status === "generating");
    if (anyInFlight && !pollRef.current) {
      pollRef.current = setInterval(refresh, 2000);
    } else if (!anyInFlight && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [kits, refresh]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav email={user.email} />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        <CreateKitPanel onCreated={(kit) => setKits((prev) => [kit, ...prev])} />

        <section>
          <h2 className="text-lg font-semibold text-slate-900">Your kits</h2>
          {loadingKits ? (
            <p className="mt-4 text-sm text-slate-500">Loading kits…</p>
          ) : kits.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              No kits yet — create one above to get started.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {kits.map((kit) => (
                <li key={kit.id}>
                  <Link
                    href={`/kits/${kit.id}`}
                    className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 hover:shadow"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{kit.company ?? kit.company_url}</p>
                        <p className="truncate text-sm text-slate-500">{kit.role ?? kit.jd_preview}</p>
                      </div>
                      <KitStatusBadge status={kit.status} />
                    </div>
                    {kit.status === "generating" && kit.step && (
                      <p className="mt-2 text-xs text-indigo-600">{GENERATION_STEP_LABELS[kit.step] ?? kit.step}…</p>
                    )}
                    {kit.status === "failed" && kit.error && <p className="mt-2 text-xs text-red-600">{kit.error.message}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
