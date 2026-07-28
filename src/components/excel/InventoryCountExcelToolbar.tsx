"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { createClient } from "@/lib/supabase";
import type { Product } from "@/types";
import {
  readExcelRaw,
  applyColumnMapping,
  suggestColumnMapping,
} from "@/lib/excel";
import {
  INVENTORY_COUNT_COLUMNS,
  downloadInventoryCountTemplate,
  exportInventoryCount,
  buildInventoryCountPreview,
  applyInventoryCountImport,
  type InventoryCountExportRow,
  type InventoryImportPreviewRow,
} from "@/lib/excel/inventory-count";

type ExistingItem = {
  id: string;
  product_id: string;
  product?: Product | null;
};

type Props = {
  countId: string;
  countNumber: string;
  exportRows: InventoryCountExportRow[];
  catalog: Product[];
  existingItems: ExistingItem[];
  disabled?: boolean;
  onImported: () => void;
};

export function InventoryCountExcelToolbar({
  countId,
  countNumber,
  exportRows,
  catalog,
  existingItems,
  disabled,
  onImported,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
      >
        <FileSpreadsheet className="h-4 w-4" />
        Excel
        <ChevronDown
          className={`h-4 w-4 transition ${menuOpen ? "rotate-180" : ""}`}
        />
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute end-0 z-40 mt-1 min-w-[11.5rem] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            disabled={exportRows.length === 0}
            onClick={() => {
              setMenuOpen(false);
              exportInventoryCount(exportRows, countNumber);
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <Download className="h-4 w-4 text-gray-500" />
            تصدير
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              downloadInventoryCountTemplate();
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm text-gray-700 hover:bg-gray-50"
          >
            <FileSpreadsheet className="h-4 w-4 text-gray-500" />
            تنزيل القالب
          </button>
          {!disabled && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setShowImport(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm text-emerald-800 hover:bg-emerald-50"
            >
              <Upload className="h-4 w-4" />
              استيراد
            </button>
          )}
        </div>
      )}

      <InventoryCountImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        countId={countId}
        catalog={catalog}
        existingItems={existingItems}
        onDone={onImported}
      />
    </div>
  );
}

type ImportProps = {
  open: boolean;
  onClose: () => void;
  countId: string;
  catalog: Product[];
  existingItems: ExistingItem[];
  onDone: () => void;
};

type Step = "upload" | "map" | "edit";

function InventoryCountImportModal({
  open,
  onClose,
  countId,
  catalog,
  existingItems,
  onDone,
}: ImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();
  const columns = INVENTORY_COUNT_COLUMNS;

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [editRows, setEditRows] = useState<Record<string, unknown>[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<InventoryImportPreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [resultMsg, setResultMsg] = useState("");
  const [parseError, setParseError] = useState("");

  const mappedKeys = useMemo(
    () => columns.filter((c) => Object.values(mapping).includes(c.key)),
    [columns, mapping]
  );

  const rebuildPreview = useCallback(
    (rows: Record<string, unknown>[]) => {
      setPreview(buildInventoryCountPreview(rows, catalog, existingItems));
    },
    [catalog, existingItems]
  );

  function reset() {
    setStep("upload");
    setFileName("");
    setHeaders([]);
    setMatrix([]);
    setMapping({});
    setEditRows([]);
    setExcluded(new Set());
    setPreview([]);
    setBusy(false);
    setProgress({ done: 0, total: 0 });
    setResultMsg("");
    setParseError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleClose() {
    if (busy) return;
    reset();
    onClose();
  }

  async function handleFile(file: File) {
    setParseError("");
    setResultMsg("");
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const raw = readExcelRaw(buffer);
      if (!raw.headers.length || !raw.matrix.length) {
        setParseError("الملف فاضي أو غير صالح.");
        return;
      }
      setHeaders(raw.headers);
      setMatrix(raw.matrix);
      setMapping(suggestColumnMapping(raw.headers, columns));
      setStep("map");
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "تعذّر قراءة الملف");
    }
  }

  function setColumnMap(colIndex: number, fieldKey: string) {
    setMapping((prev) => {
      const next = { ...prev };
      if (fieldKey) {
        for (const [k, v] of Object.entries(next)) {
          if (v === fieldKey && Number(k) !== colIndex) delete next[Number(k)];
        }
        next[colIndex] = fieldKey;
      } else {
        delete next[colIndex];
      }
      return next;
    });
  }

  function goToEdit() {
    const required = columns.filter((c) => c.required);
    const missing = required.filter(
      (c) => !Object.values(mapping).includes(c.key)
    );
    if (missing.length) {
      setParseError(
        `لازم تعيّن: ${missing.map((m) => m.header).join("، ")}`
      );
      return;
    }
    setParseError("");
    const rows = applyColumnMapping(matrix, mapping);
    setEditRows(rows);
    setExcluded(new Set());
    rebuildPreview(rows);
    setStep("edit");
  }

  function refresh(rows: Record<string, unknown>[], excl: Set<number>) {
    rebuildPreview(rows.filter((_, i) => !excl.has(i)));
  }

  function handleCellChange(rowIdx: number, key: string, value: string) {
    setEditRows((prev) => {
      const next = prev.map((r, i) =>
        i === rowIdx ? { ...r, [key]: value } : r
      );
      refresh(next, excluded);
      return next;
    });
  }

  function handleExcludeToggle(rowIdx: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx);
      else next.add(rowIdx);
      refresh(editRows, next);
      return next;
    });
  }

  const stats = useMemo(() => {
    return {
      update: preview.filter((r) => r.action === "update").length,
      add: preview.filter((r) => r.action === "add").length,
      error: preview.filter((r) => r.action === "error").length,
      excluded: excluded.size,
    };
  }, [preview, excluded.size]);

  const statusByEditIndex = useMemo(() => {
    const map = new Map<number, InventoryImportPreviewRow>();
    let pi = 0;
    for (let i = 0; i < editRows.length; i++) {
      if (excluded.has(i)) continue;
      const p = preview[pi++];
      if (p) map.set(i, p);
    }
    return map;
  }, [editRows.length, excluded, preview]);

  async function handleApply() {
    const ok = preview.filter(
      (r) => r.action === "update" || r.action === "add"
    );
    if (!ok.length) return;
    setBusy(true);
    setResultMsg("");
    setProgress({ done: 0, total: ok.length });
    try {
      const result = await applyInventoryCountImport(
        supabase,
        countId,
        preview,
        (done, total) => setProgress({ done, total })
      );
      setResultMsg(
        `تم: ${result.updated} تحديث، ${result.added} إضافة` +
          (result.failed ? `، ${result.failed} فشل` : "")
      );
      onDone();
    } catch (e) {
      setResultMsg(e instanceof Error ? e.message : "فشل الاستيراد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="استيراد كميات الجرد من Excel"
      wide
      className="max-w-5xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          {(
            [
              ["upload", "1. رفع"],
              ["map", "2. تعيين الأعمدة"],
              ["edit", "3. تعديل واستيراد"],
            ] as const
          ).map(([id, label]) => (
            <span
              key={id}
              className={`rounded-full px-3 py-1 font-medium ${
                step === id
                  ? "bg-blue-700 text-white"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {label}
            </span>
          ))}
        </div>

        {step === "upload" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              الملف لازم فيه على الأقل عمود الكود وعمود الكمية الفعلية. الأصناف
              الجديدة هتتضاف لجلسة الجرد.
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              <Upload className="h-4 w-4" />
              اختر ملف
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </div>
        )}

        {step === "map" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {fileName} · {matrix.length} صف — عيّن كل عمود:
            </p>
            <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-right">عمود الملف</th>
                    <th className="px-3 py-2 text-right">يُحفظ كـ</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium">
                        {h || `(عمود ${i + 1})`}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={mapping[i] ?? ""}
                          onChange={(e) => setColumnMap(i, e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                        >
                          <option value="">— تجاهل —</option>
                          {columns.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.header}
                              {c.required ? " *" : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === "edit" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">
                تحديث: {stats.update}
              </span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
                إضافة: {stats.add}
              </span>
              <span className="rounded-full bg-red-100 px-3 py-1 text-red-800">
                أخطاء: {stats.error}
              </span>
            </div>
            <div className="max-h-80 overflow-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-max text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-center">✓</th>
                    <th className="px-2 py-2 text-right">الحالة</th>
                    {mappedKeys.map((c) => (
                      <th key={c.key} className="px-2 py-2 text-right">
                        {c.header}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right">ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {editRows.map((row, rowIdx) => {
                    const st = statusByEditIndex.get(rowIdx);
                    const isOut = excluded.has(rowIdx);
                    return (
                      <tr
                        key={rowIdx}
                        className={`border-t border-gray-100 ${isOut ? "opacity-50" : ""}`}
                      >
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={!isOut}
                            disabled={busy}
                            onChange={() => handleExcludeToggle(rowIdx)}
                          />
                        </td>
                        <td className="px-2 py-1 text-xs">
                          {isOut
                            ? "مستبعد"
                            : st?.action === "update"
                              ? "تحديث"
                              : st?.action === "add"
                                ? "إضافة"
                                : "خطأ"}
                        </td>
                        {mappedKeys.map((c) => (
                          <td key={c.key} className="px-1 py-1">
                            <input
                              type="text"
                              disabled={busy || isOut}
                              value={String(row[c.key] ?? "")}
                              onChange={(e) =>
                                handleCellChange(rowIdx, c.key, e.target.value)
                              }
                              className="w-28 rounded border border-gray-200 px-1.5 py-1 text-sm"
                            />
                          </td>
                        ))}
                        <td className="max-w-[10rem] px-2 py-1 text-xs text-gray-500">
                          {st
                            ? [...st.errors, ...st.warnings].join(" · ") || "—"
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {parseError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {parseError}
          </p>
        )}
        {busy && (
          <p className="text-xs text-gray-500">
            جاري الحفظ… {progress.done}/{progress.total}
          </p>
        )}
        {resultMsg && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {resultMsg}
          </p>
        )}

        <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-3">
          <div>
            {step === "edit" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStep("map")}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
              >
                رجوع
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
            >
              إغلاق
            </button>
            {step === "map" && (
              <button
                type="button"
                onClick={goToEdit}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white"
              >
                التالي
              </button>
            )}
            {step === "edit" && (
              <button
                type="button"
                disabled={busy || stats.update + stats.add === 0}
                onClick={() => void handleApply()}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                تأكيد ({stats.update + stats.add})
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
