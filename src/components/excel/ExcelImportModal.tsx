"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase";
import type { Category, Customer, Product, Supplier } from "@/types";
import {
  type ExcelEntity,
  getColumns,
  getEntityLabel,
  readExcelRaw,
  applyColumnMapping,
  suggestColumnMapping,
  buildProductPreview,
  applyProductImport,
  type ProductPreviewRow,
  buildPartyPreview,
  applyPartyImport,
  type PartyPreviewRow,
  type PartyKind,
  buildCategoryPreview,
  applyCategoryImport,
  type CategoryPreviewRow,
} from "@/lib/excel";

type Props = {
  open: boolean;
  onClose: () => void;
  entity: ExcelEntity;
  products?: Product[];
  categories?: Category[];
  customers?: Customer[];
  suppliers?: Supplier[];
  onDone: () => void;
};

type Step = "upload" | "map" | "edit";
type AnyPreview = ProductPreviewRow | PartyPreviewRow | CategoryPreviewRow;

export function ExcelImportModal({
  open,
  onClose,
  entity,
  products = [],
  categories = [],
  customers = [],
  suppliers = [],
  onDone,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();
  const { success: toastSuccess } = useToast();
  const columns = useMemo(() => getColumns(entity), [entity]);
  const label = getEntityLabel(entity);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [editRows, setEditRows] = useState<Record<string, unknown>[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<AnyPreview[]>([]);
  const [updateQuantities, setUpdateQuantities] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [resultMsg, setResultMsg] = useState("");
  const [parseError, setParseError] = useState("");

  const mappedKeys = useMemo(
    () => columns.filter((c) => Object.values(mapping).includes(c.key)),
    [columns, mapping]
  );

  const rebuildPreview = useCallback(
    (rows: Record<string, unknown>[], qtyFlag: boolean) => {
      if (entity === "products") {
        setPreview(
          buildProductPreview(rows, products, { updateQuantities: qtyFlag })
        );
      } else if (entity === "customers") {
        setPreview(buildPartyPreview(rows, customers));
      } else if (entity === "suppliers") {
        setPreview(buildPartyPreview(rows, suppliers));
      } else {
        setPreview(buildCategoryPreview(rows, categories));
      }
    },
    [entity, products, customers, suppliers, categories]
  );

  const reset = useCallback(() => {
    setStep("upload");
    setFileName("");
    setHeaders([]);
    setMatrix([]);
    setMapping({});
    setEditRows([]);
    setExcluded(new Set());
    setPreview([]);
    setUpdateQuantities(false);
    setBusy(false);
    setProgress({ done: 0, total: 0 });
    setResultMsg("");
    setParseError("");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

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
        setParseError("الملف فاضي. تأكد إن فيه صف عناوين وصفوف بيانات.");
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
          if (v === fieldKey && Number(k) !== colIndex) {
            delete next[Number(k)];
          }
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
        `لازم تعيّن الأعمدة المطلوبة: ${missing.map((m) => m.header).join("، ")}`
      );
      return;
    }
    setParseError("");
    const rows = applyColumnMapping(matrix, mapping);
    setEditRows(rows);
    setExcluded(new Set());
    rebuildPreview(rows, updateQuantities);
    setStep("edit");
  }

  function refreshPreviewFromEdit(
    rows: Record<string, unknown>[],
    excl: Set<number>,
    qty: boolean
  ) {
    rebuildPreview(
      rows.filter((_, i) => !excl.has(i)),
      qty
    );
  }

  function handleQtyChange(checked: boolean) {
    setUpdateQuantities(checked);
    refreshPreviewFromEdit(editRows, excluded, checked);
  }

  function handleExcludeToggle(rowIdx: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx);
      else next.add(rowIdx);
      refreshPreviewFromEdit(editRows, next, updateQuantities);
      return next;
    });
  }

  function handleCellChange(rowIdx: number, key: string, value: string) {
    setEditRows((prev) => {
      const next = prev.map((r, i) =>
        i === rowIdx ? { ...r, [key]: value } : r
      );
      refreshPreviewFromEdit(next, excluded, updateQuantities);
      return next;
    });
  }

  const stats = useMemo(() => {
    const create = preview.filter((r) => r.action === "create").length;
    const update = preview.filter((r) => r.action === "update").length;
    const error = preview.filter((r) => r.action === "error").length;
    return {
      create,
      update,
      error,
      excluded: excluded.size,
      total: editRows.length,
    };
  }, [preview, excluded.size, editRows.length]);

  const statusByEditIndex = useMemo(() => {
    const map = new Map<number, AnyPreview>();
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
      (r) => r.action === "create" || r.action === "update"
    );
    if (!ok.length) return;
    setBusy(true);
    setResultMsg("");
    setProgress({ done: 0, total: ok.length });
    try {
      let result = { created: 0, updated: 0, failed: 0 };
      if (entity === "products") {
        result = await applyProductImport(
          supabase,
          preview as ProductPreviewRow[],
          categories,
          { updateQuantities },
          (done, total) => setProgress({ done, total })
        );
      } else if (entity === "categories") {
        result = await applyCategoryImport(
          supabase,
          preview as CategoryPreviewRow[],
          (done, total) => setProgress({ done, total })
        );
      } else {
        result = await applyPartyImport(
          supabase,
          entity as PartyKind,
          preview as PartyPreviewRow[],
          (done, total) => setProgress({ done, total })
        );
      }
      const importedCount = result.created + result.updated;
      const msg =
        `تم: ${result.created} جديد، ${result.updated} تحديث` +
        (result.failed ? `، ${result.failed} فشل` : "");
      setResultMsg(msg);
      toastSuccess(
        `تم استيراد ${importedCount} صف من ${label}${msg ? `: ${msg}` : ""}`
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
      title={`استيراد ${label} من Excel`}
      wide
      className="max-w-5xl"
    >
      <div className="space-y-4">
        <StepTabs step={step} />

        {step === "upload" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              ارفع ملف Excel أو CSV، بعدين هتعيّن كل عمود لحقل النظام وتقدر تعدّل
              القيم قبل الحفظ.
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-600">
                الملف:{" "}
                <span className="font-medium text-gray-900">{fileName}</span>
                {" · "}
                {matrix.length} صف
              </p>
              <button
                type="button"
                onClick={() => reset()}
                className="text-sm text-gray-500 hover:text-gray-800"
              >
                تغيير الملف
              </button>
            </div>
            <p className="text-sm text-gray-600">
              حدّد لكل عمود في الملف إيه الحقل اللي يقابله في النظام:
            </p>
            <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-right">عمود الملف</th>
                    <th className="px-3 py-2 text-right">عينة</th>
                    <th className="px-3 py-2 text-right">يُحفظ كـ</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {h || `(عمود ${i + 1})`}
                      </td>
                      <td className="max-w-[10rem] truncate px-3 py-2 text-xs text-gray-500">
                        {matrix
                          .slice(0, 3)
                          .map((r) => r[i])
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={mapping[i] ?? ""}
                          onChange={(e) => setColumnMap(i, e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
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
            {entity === "products" && (
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <input
                  type="checkbox"
                  checked={updateQuantities}
                  onChange={(e) => handleQtyChange(e.target.checked)}
                  className="mt-0.5"
                  disabled={busy}
                />
                <span>
                  تحديث الكميات من الملف عند تحديث أصناف موجودة (افتراضي: إيقاف)
                </span>
              </label>
            )}

            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-gray-100 px-3 py-1">
                صفوف: {stats.total}
              </span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
                جديد: {stats.create}
              </span>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">
                تحديث: {stats.update}
              </span>
              <span className="rounded-full bg-red-100 px-3 py-1 text-red-800">
                أخطاء: {stats.error}
              </span>
              {stats.excluded > 0 && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                  مستبعد: {stats.excluded}
                </span>
              )}
            </div>

            <p className="text-xs text-gray-500">
              عدّل أي خلية قبل الاستيراد. ألغِ التحديد لاستبعاد الصف.
            </p>

            <div className="max-h-80 overflow-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-max text-sm">
                <thead className="sticky top-0 z-10 bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-2 text-center">✓</th>
                    <th className="px-2 py-2 text-right">#</th>
                    <th className="px-2 py-2 text-right">الحالة</th>
                    {mappedKeys.map((c) => (
                      <th
                        key={c.key}
                        className="whitespace-nowrap px-2 py-2 text-right"
                      >
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
                        className={`border-t border-gray-100 ${isOut ? "bg-gray-50 opacity-50" : ""}`}
                      >
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={!isOut}
                            disabled={busy}
                            onChange={() => handleExcludeToggle(rowIdx)}
                          />
                        </td>
                        <td className="px-2 py-1 text-gray-500">{rowIdx + 1}</td>
                        <td className="px-2 py-1">
                          {isOut ? (
                            <span className="text-xs text-gray-400">مستبعد</span>
                          ) : st ? (
                            <ActionBadge action={st.action} />
                          ) : (
                            "—"
                          )}
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
                              className="w-28 min-w-[5rem] rounded border border-gray-200 px-1.5 py-1 text-sm focus:border-blue-500 focus:outline-none disabled:bg-transparent"
                            />
                          </td>
                        ))}
                        <td className="max-w-[12rem] px-2 py-1 text-xs text-gray-500">
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
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{
                  width: progress.total
                    ? `${Math.round((progress.done / progress.total) * 100)}%`
                    : "0%",
                }}
              />
            </div>
            <p className="text-xs text-gray-500">
              جاري الحفظ… {progress.done}/{progress.total}
            </p>
          </div>
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
                onClick={() => {
                  setStep("map");
                  setResultMsg("");
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                رجوع لتعيين الأعمدة
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              إغلاق
            </button>
            {step === "map" && (
              <button
                type="button"
                onClick={goToEdit}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
              >
                التالي: مراجعة وتعديل
              </button>
            )}
            {step === "edit" && (
              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={busy || stats.create + stats.update === 0}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                تأكيد الاستيراد ({stats.create + stats.update})
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function StepTabs({ step }: { step: Step }) {
  const items: { id: Step; label: string }[] = [
    { id: "upload", label: "1. رفع" },
    { id: "map", label: "2. تعيين الأعمدة" },
    { id: "edit", label: "3. تعديل واستيراد" },
  ];
  const order: Step[] = ["upload", "map", "edit"];
  const current = order.indexOf(step);
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => {
        const active = item.id === step;
        const done = i < current;
        return (
          <span
            key={item.id}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              active
                ? "bg-blue-700 text-white"
                : done
                  ? "bg-blue-100 text-blue-800"
                  : "bg-gray-100 text-gray-500"
            }`}
          >
            {item.label}
          </span>
        );
      })}
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    create: "bg-emerald-100 text-emerald-800",
    update: "bg-blue-100 text-blue-800",
    error: "bg-red-100 text-red-800",
    skip: "bg-gray-100 text-gray-600",
  };
  const labels: Record<string, string> = {
    create: "جديد",
    update: "تحديث",
    error: "خطأ",
    skip: "تجاهل",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${map[action] ?? map.skip}`}
    >
      {labels[action] ?? action}
    </span>
  );
}
