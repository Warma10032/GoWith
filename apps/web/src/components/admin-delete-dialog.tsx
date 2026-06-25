"use client";

import type { FormEvent } from "react";
import { LoaderCircle, Trash2, X } from "lucide-react";

export type DeleteDialogTarget = {
  id: string;
  title: string;
  description?: string;
};

export function AdminDeleteDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: DeleteDialogTarget | null;
  busy: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  if (!target) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onConfirm();
  }

  const isDeleting = busy === "删除";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl border border-line bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#fff1ee] px-3 py-1 text-xs font-semibold text-[#9a341f]">
              <Trash2 size={14} />
              软删除到回收站
            </div>
            <h2 className="mt-3 text-lg font-semibold">{target.title}</h2>
            {target.description ? (
              <p className="mt-1 text-sm leading-6 text-muted">{target.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line p-2 text-muted hover:text-ink"
            disabled={!!busy}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mt-4 rounded-lg bg-[#fbfaf8] px-3 py-2 text-sm text-muted">
          该操作会进入回收站，可在回收站恢复。
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium"
            disabled={!!busy}
          >
            取消
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-[#9a341f] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={!!busy}
          >
            {isDeleting ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}
            确认删除
          </button>
        </div>
      </form>
    </div>
  );
}
