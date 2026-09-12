"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useDebouncedSave } from "@/lib/useDebouncedSave";
import { SaveIndicator } from "./SaveIndicator";
import type { Flashcard, KitDetail } from "@/lib/types";

function FlashcardEditor({ kitId, card, onUpdated, onDeleted }: { kitId: string; card: Flashcard; onUpdated: (kit: KitDetail) => void; onDeleted: (kit: KitDetail) => void }) {
  const front = useDebouncedSave(card.front, async (value) => {
    const updated = await api.patch<KitDetail>(`/api/kits/${kitId}/flashcards/${card.id}`, { front: value });
    onUpdated(updated);
  });
  const back = useDebouncedSave(card.back, async (value) => {
    const updated = await api.patch<KitDetail>(`/api/kits/${kitId}/flashcards/${card.id}`, { back: value });
    onUpdated(updated);
  });

  async function handleDelete() {
    const updated = await api.delete<KitDetail>(`/api/kits/${kitId}/flashcards/${card.id}`);
    onDeleted(updated);
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        {card.isLocked && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{card.origin === "user" ? "Your card" : "Pinned"}</span>}
        <button type="button" onClick={handleDelete} aria-label="Delete flashcard" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
          ✕
        </button>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-500">Front</label>
            <SaveIndicator state={front.state} />
          </div>
          <textarea rows={2} value={front.value} onChange={(e) => front.update(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-500">Back</label>
            <SaveIndicator state={back.state} />
          </div>
          <textarea rows={2} value={back.value} onChange={(e) => back.update(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
      </div>
    </div>
  );
}

export function FlashcardsPanel({ kitId, detail, onUpdated }: { kitId: string; detail: KitDetail; onUpdated: (kit: KitDetail) => void }) {
  const kit = detail.kit!;
  const [adding, setAdding] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  async function handleAdd() {
    if (!front.trim() || !back.trim()) return;
    const updated = await api.post<KitDetail>(`/api/kits/${kitId}/flashcards`, { front, back, requirement_ids: [] });
    onUpdated(updated);
    setFront("");
    setBack("");
    setAdding(false);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Flashcards</h2>
        <button type="button" onClick={() => setAdding((a) => !a)} className="text-sm font-medium text-indigo-600 hover:underline">
          + Add a flashcard
        </button>
      </div>

      {adding && (
        <div className="mt-3 space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
          <textarea placeholder="Front" rows={2} value={front} onChange={(e) => setFront(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <textarea placeholder="Back" rows={2} value={back} onChange={(e) => setBack(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <div className="flex gap-2">
            <button type="button" onClick={handleAdd} className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500">
              Add
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {kit.flashcards.length === 0 ? (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500 sm:col-span-2">No flashcards yet.</p>
        ) : (
          kit.flashcards.map((c) => <FlashcardEditor key={c.id} kitId={kitId} card={c} onUpdated={onUpdated} onDeleted={onUpdated} />)
        )}
      </div>
    </section>
  );
}
