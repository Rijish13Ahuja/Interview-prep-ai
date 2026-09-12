"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@/lib/api";
import { useDebouncedSave } from "@/lib/useDebouncedSave";
import { SaveIndicator } from "./SaveIndicator";
import { QUESTION_CATEGORIES, type KitDetail, type Question } from "@/lib/types";

export function QuestionCard({
  kitId,
  question,
  onUpdated,
  onDeleted,
  onMoveUp,
  onMoveDown,
}: {
  kitId: string;
  question: Question;
  onUpdated: (kit: KitDetail) => void;
  onDeleted: (kit: KitDetail) => void;
  /** Omitted (not just disabled) at the first/last position — a fully keyboard-operable alternative to dragging. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: question.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const prompt = useDebouncedSave(question.prompt, async (value) => {
    const updated = await api.patch<KitDetail>(`/api/kits/${kitId}/questions/${question.id}`, { prompt: value });
    onUpdated(updated);
  });
  const answerOutline = useDebouncedSave(question.answer_outline, async (value) => {
    const updated = await api.patch<KitDetail>(`/api/kits/${kitId}/questions/${question.id}`, { answer_outline: value });
    onUpdated(updated);
  });

  async function handleCategoryChange(category: string) {
    const updated = await api.patch<KitDetail>(`/api/kits/${kitId}/questions/${question.id}`, { category });
    onUpdated(updated);
  }

  async function handleDifficultyChange(difficulty: number) {
    const updated = await api.patch<KitDetail>(`/api/kits/${kitId}/questions/${question.id}`, { difficulty });
    onUpdated(updated);
  }

  async function handleDelete() {
    const updated = await api.delete<KitDetail>(`/api/kits/${kitId}/questions/${question.id}`);
    onDeleted(updated);
  }

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
            className="cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
          >
            ⠿
          </button>
          <button
            type="button"
            aria-label="Move question up"
            disabled={!onMoveUp}
            onClick={onMoveUp}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Move question down"
            disabled={!onMoveDown}
            onClick={onMoveDown}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ↓
          </button>
          {question.isLocked && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
              {question.origin === "user" ? "Your question" : "Pinned"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={question.category}
            onChange={(e) => handleCategoryChange(e.target.value)}
            aria-label="Move to category"
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            {QUESTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={question.difficulty}
            onChange={(e) => handleDifficultyChange(Number(e.target.value))}
            aria-label="Difficulty"
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            <option value={1}>Easy</option>
            <option value={2}>Medium</option>
            <option value={3}>Hard</option>
          </select>
          <button type="button" onClick={handleDelete} aria-label="Delete question" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
            ✕
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-500">Question</label>
            <SaveIndicator state={prompt.state} />
          </div>
          <textarea
            rows={2}
            value={prompt.value}
            onChange={(e) => prompt.update(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-500">Answer outline</label>
            <SaveIndicator state={answerOutline.state} />
          </div>
          <textarea
            rows={2}
            value={answerOutline.value}
            onChange={(e) => answerOutline.update(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>
    </div>
  );
}
