"use client";

import { useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { api, ApiError } from "@/lib/api";
import { QUESTION_CATEGORIES, type KitDetail, type QuestionCategoryName } from "@/lib/types";
import { QuestionCard } from "./QuestionCard";

const CATEGORY_LABELS: Record<QuestionCategoryName, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};

export function QuestionsPanel({ kitId, detail, onUpdated }: { kitId: string; detail: KitDetail; onUpdated: (kit: KitDetail) => void }) {
  const kit = detail.kit!;
  const [activeCategory, setActiveCategory] = useState<QuestionCategoryName>("technical");
  const [adding, setAdding] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newOutline, setNewOutline] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyboard sensor (Tab to the drag handle, Space to pick up, Arrow keys to move, Space to
  // drop) alongside pointer drag — plus explicit Move up/down buttons on each card as a more
  // discoverable, unambiguous keyboard-accessible alternative to drag-and-drop.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const categoryQuestions = kit.questions.filter((q) => q.category === activeCategory);

  async function applyCategoryOrder(reorderedCategory: typeof categoryQuestions) {
    // The API reorders the whole kit's question array — splice the reordered
    // category's ids back into their original positions among the other categories.
    const categoryIdSet = new Set(categoryQuestions.map((q) => q.id));
    let cursor = 0;
    const fullOrderedIds = kit.questions.map((q) => (categoryIdSet.has(q.id) ? reorderedCategory[cursor++].id : q.id));

    const updated = await api.patch<KitDetail>(`/api/kits/${kitId}/questions/reorder`, { orderedIds: fullOrderedIds });
    onUpdated(updated);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndexInCategory = categoryQuestions.findIndex((q) => q.id === active.id);
    const newIndexInCategory = categoryQuestions.findIndex((q) => q.id === over.id);
    await applyCategoryOrder(arrayMove(categoryQuestions, oldIndexInCategory, newIndexInCategory));
  }

  async function handleMove(questionId: string, direction: -1 | 1) {
    const index = categoryQuestions.findIndex((q) => q.id === questionId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= categoryQuestions.length) return;
    await applyCategoryOrder(arrayMove(categoryQuestions, index, targetIndex));
  }

  async function handleAdd() {
    if (!newPrompt.trim() || !newOutline.trim()) return;
    const updated = await api.post<KitDetail>(`/api/kits/${kitId}/questions`, {
      category: activeCategory,
      prompt: newPrompt,
      answer_outline: newOutline,
      difficulty: 2,
      requirement_ids: [],
    });
    onUpdated(updated);
    setNewPrompt("");
    setNewOutline("");
    setAdding(false);
  }

  async function handleRegenerate() {
    setError(null);
    setRegenerating(true);
    try {
      const updated = await api.post<KitDetail>(`/api/kits/${kitId}/regenerate/questions/${activeCategory}`);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to regenerate.");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Questions</h2>
        <p className="text-xs text-slate-500">{kit.questions.length} total</p>
      </div>

      <div role="tablist" className="mt-4 flex flex-wrap gap-1 border-b border-slate-200">
        {QUESTION_CATEGORIES.map((c) => {
          const count = kit.questions.filter((q) => q.category === c).length;
          return (
            <button
              key={c}
              role="tab"
              aria-selected={activeCategory === c}
              onClick={() => setActiveCategory(c)}
              className={`rounded-t-md px-3 py-2 text-sm font-medium ${
                activeCategory === c ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {CATEGORY_LABELS[c]} ({count})
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button type="button" onClick={() => setAdding((a) => !a)} className="text-sm font-medium text-indigo-600 hover:underline">
          + Add a question
        </button>
        <button
          type="button"
          disabled={regenerating}
          onClick={handleRegenerate}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {regenerating ? "Regenerating…" : `Regenerate ${CATEGORY_LABELS[activeCategory]}`}
        </button>
      </div>
      {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {adding && (
        <div className="mt-3 space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
          <textarea
            placeholder="Question prompt"
            rows={2}
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <textarea
            placeholder="Answer outline"
            rows={2}
            value={newOutline}
            onChange={(e) => setNewOutline(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
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

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={categoryQuestions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
          <div className="mt-4 space-y-3">
            {categoryQuestions.length === 0 ? (
              <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">No questions in this category yet.</p>
            ) : (
              categoryQuestions.map((q, i) => (
                <QuestionCard
                  key={q.id}
                  kitId={kitId}
                  question={q}
                  onUpdated={onUpdated}
                  onDeleted={onUpdated}
                  onMoveUp={i > 0 ? () => handleMove(q.id, -1) : undefined}
                  onMoveDown={i < categoryQuestions.length - 1 ? () => handleMove(q.id, 1) : undefined}
                />
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
