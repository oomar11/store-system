"use client";

import { Pencil, Trash2 } from "lucide-react";

/** أزرار تعديل/حذف صغيرة لجداول التقارير */
export function ReportRowActions({
  onEdit,
  onDelete,
  editLabel = "تعديل",
  deleteLabel = "حذف",
  busy,
}: {
  onEdit?: () => void;
  onDelete?: () => void;
  editLabel?: string;
  deleteLabel?: string;
  busy?: boolean;
}) {
  if (!onEdit && !onDelete) return <span className="text-xs text-gray-300">—</span>;
  return (
    <div
      className="flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {onEdit ? (
        <button
          type="button"
          disabled={busy}
          onClick={onEdit}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          title={editLabel}
        >
          <Pencil className="h-3 w-3" />
          {editLabel}
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          title={deleteLabel}
        >
          <Trash2 className="h-3 w-3" />
          {deleteLabel}
        </button>
      ) : null}
    </div>
  );
}
