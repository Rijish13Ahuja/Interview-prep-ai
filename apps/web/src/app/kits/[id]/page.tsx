"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "@/lib/useSession";
import { api } from "@/lib/api";
import type { KitDetail } from "@/lib/types";
import { Nav } from "@/components/Nav";
import { GenerationProgress } from "@/components/GenerationProgress";
import { CompanyBriefPanel } from "@/components/CompanyBriefPanel";
import { RequirementsPanel } from "@/components/RequirementsPanel";
import { QuestionsPanel } from "@/components/QuestionsPanel";
import { FlashcardsPanel } from "@/components/FlashcardsPanel";
import { SchedulePanel } from "@/components/SchedulePanel";

export default function KitBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: sessionLoading } = useSession();
  const [detail, setDetail] = useState<KitDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      try {
        const data = await api.get<KitDetail>(`/api/kits/${id}`);
        if (!cancelled) setDetail(data);
      } catch {
        if (!cancelled) setNotFound(true);
      }
    }
    load();

    return () => {
      cancelled = true;
    };
  }, [user, id]);

  useEffect(() => {
    const inFlight = detail?.status === "pending" || detail?.status === "generating";
    if (inFlight && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        try {
          const data = await api.get<KitDetail>(`/api/kits/${id}`);
          setDetail(data);
        } catch {
          // transient poll failure — next tick retries
        }
      }, 2000);
    } else if (!inFlight && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [detail?.status, id]);

  if (sessionLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        <p>Loading…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Nav email={user.email} />
        <main className="mx-auto max-w-3xl px-4 py-12 text-center">
          <p className="text-slate-600">Kit not found.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-indigo-600 hover:underline">
            Back to dashboard
          </Link>
        </main>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        <p>Loading kit…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav email={user.email} />
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
            ← All kits
          </Link>
          {detail.status === "ok" && (
            <Link href={`/kits/${id}/practice`} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              Practice mode
            </Link>
          )}
        </div>

        {detail.status !== "ok" ? (
          <GenerationProgress detail={detail} />
        ) : (
          detail.kit && (
            <div className="space-y-6">
              <CompanyBriefPanel kitId={id} kit={detail.kit} companyBriefLocked={detail.companyBriefLocked} onUpdated={setDetail} />
              <RequirementsPanel kit={detail.kit} />
              <QuestionsPanel kitId={id} detail={detail} onUpdated={setDetail} />
              <FlashcardsPanel kitId={id} detail={detail} onUpdated={setDetail} />
              <SchedulePanel kitId={id} detail={detail} onUpdated={setDetail} />
            </div>
          )
        )}
      </main>
    </div>
  );
}
