"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import type { Category, Customer, Product, Supplier } from "@/types";
import type { ExcelEntity } from "@/lib/excel";
import {
  exportProducts,
  downloadProductTemplate,
  exportParties,
  downloadPartyTemplate,
  exportCategories,
  downloadCategoryTemplate,
} from "@/lib/excel";
import { ExcelImportModal } from "./ExcelImportModal";

type Props = {
  entity: ExcelEntity;
  exportDisabled?: boolean;
  products?: Product[];
  categories?: Category[];
  customers?: Customer[];
  suppliers?: Supplier[];
  exportProducts?: Product[];
  exportCustomers?: Customer[];
  exportSuppliers?: Supplier[];
  exportCategories?: Category[];
  onImported: () => void;
  allowImport?: boolean;
};

export function ExcelToolbar({
  entity,
  exportDisabled,
  products = [],
  categories = [],
  customers = [],
  suppliers = [],
  exportProducts: exportProductsList,
  exportCustomers,
  exportSuppliers,
  exportCategories: exportCategoriesList,
  onImported,
  allowImport = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleExport() {
    setOpen(false);
    if (entity === "products")
      exportProducts(exportProductsList ?? products);
    else if (entity === "customers")
      exportParties("customers", exportCustomers ?? customers);
    else if (entity === "suppliers")
      exportParties("suppliers", exportSuppliers ?? suppliers);
    else exportCategories(exportCategoriesList ?? categories);
  }

  function handleTemplate() {
    setOpen(false);
    if (entity === "products") downloadProductTemplate();
    else if (entity === "categories") downloadCategoryTemplate();
    else if (entity === "customers") downloadPartyTemplate("customers");
    else downloadPartyTemplate("suppliers");
  }

  function handleImport() {
    setOpen(false);
    setShowImport(true);
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
      >
        <FileSpreadsheet className="h-4 w-4" />
        Excel
        <ChevronDown
          className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute end-0 z-40 mt-1 min-w-[11.5rem] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            disabled={exportDisabled}
            onClick={handleExport}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4 shrink-0 text-gray-500" />
            تصدير
          </button>
          {allowImport && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={handleTemplate}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm text-gray-700 hover:bg-gray-50"
              >
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-gray-500" />
                تنزيل القالب
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleImport}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm text-emerald-800 hover:bg-emerald-50"
              >
                <Upload className="h-4 w-4 shrink-0" />
                استيراد
              </button>
            </>
          )}
        </div>
      )}

      {allowImport && (
        <ExcelImportModal
          open={showImport}
          onClose={() => setShowImport(false)}
          entity={entity}
          products={products}
          categories={categories}
          customers={customers}
          suppliers={suppliers}
          onDone={() => {
            onImported();
          }}
        />
      )}
    </div>
  );
}
