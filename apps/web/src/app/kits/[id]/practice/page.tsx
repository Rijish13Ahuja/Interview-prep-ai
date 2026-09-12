"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "@/lib/useSession";
import { api } from "@/lib/api";
import type { KitDetail } from "@/lib/types";
import { Nav } from "@/components/Nav";

const CONFIDENCE_LABELS: Record<number, string> = { 1: "Not confident", 2: "Somewhat confident", 3: "Confident" };

export default function PracticePage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: sessionLoading } = useSession();
  const [detail, setDetail] = useState<KitDetail | null>(null);
  const [cursor, setCursor] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.get<KitDetail>(`/api/kits/${id}`).then(setDetail);
  }, [user, id]);

  const orderedCards = useMemo(() => {
    if (!detail?.kit) return [];
    const confidence = detail.practice.confidenceByCardId;
    // Least-confident-first: unrated cards (no entry yet) are treated as the lowest confidence,
    // so a fresh practice session naturally starts with what hasn't been reviewed at all.
    return [...detail.kit.flashcards].sort((a, b) => (confidence[a.id] ?? 0) - (confidence[b.id] ?? 0));
  }, [detail]);

  if (sessionLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        <p>Loading…</p>
      </div>
    );
  }
  if (!detail?.kit) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        <p>Loading kit…</p>
      </div>
    );
  }

  const total = orderedCards.length;
  const coveredCount = detail.practice.coveredCardIds.length;
  const card = orderedCards[cursor];

  async function rate(confidence: number) {
    if (!card) return;
    const updated = await api.patch<KitDetail>(`/api/kits/${id}/practice`, { cardId: card.id, confidence });
    setDetail(updated);
    setRevealed(false);
    setCursor((c) => (c + 1 < total ? c + 1 : 0));
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav email={user.email} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Link href={`/kits/${id}`} className="text-sm text-indigo-600 hover:underline">
          ← Back to kit
        </Link>

        <div className="mt-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Practice</h1>
          <p className="text-sm text-slate-500">
            {coveredCount} / {total} covered
          </p>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-indigo-600 transition-all" style={{ width: total > 0 ? `${(coveredCount / total) * 100}%` : "0%" }} />
        </div>

        {total === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            This kit has no flashcards yet — add some from the builder.
          </p>
        ) : (
          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Card {cursor + 1} of {total}
            </p>
            <p className="mt-4 min-h-[4rem] text-lg font-medium text-slate-900">{card.front}</p>

            {revealed ? (
              <>
                <p className="mt-4 min-h-[3rem] rounded-md bg-slate-50 p-4 text-slate-700">{card.back}</p>
                <div className="mt-6">
                  <p className="text-sm text-slate-500">How confident did you feel?</p>
                  <div className="mt-2 flex justify-center gap-2">
                    {[1, 2, 3].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => rate(n)}
                        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-indigo-400 hover:text-indigo-700"
                      >
                        {CONFIDENCE_LABELS[n]}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="mt-6 rounded-md bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Reveal answer
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
