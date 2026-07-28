import { exportRows } from "./download";
import { formatDateShort } from "@/lib/utils";
import type { ReportSection } from "@/lib/reports/types";

const LABELS: Record<ReportSection, string> = {
  overview: "تقرير-نظرة-عامة",
  invoices: "تقرير-فواتير-وارباح",
  customers: "تقرير-ارباح-عملاء",
  products: "تقرير-اصناف-ومخزون",
  treasury: "تقرير-خزينة",
  expenses: "تقرير-مصروفات",
};

function accuracyAr(v: string): string {
  if (v === "reliable") return "موثوق";
  if (v === "estimated") return "تقديري";
  if (v === "mixed") return "مختلط";
  return v || "";
}

export function exportReportSection(section: ReportSection, data: any[]): void {
  let rows: Record<string, unknown>[] = [];

  switch (section) {
    case "overview":
      rows = data.map((r) => ({
        المؤشر: r.label,
        القيمة: r.value,
      }));
      break;
    case "invoices":
      rows = data.map((i) => ({
        "رقم الفاتورة": i.invoice_number,
        التاريخ: i.created_at ? formatDateShort(i.created_at) : "",
        العميل: i.customer_name,
        النوع: i.type === "sale_return" ? "مرتجع" : "بيع",
        "صافي البيع": i.revenue,
        التكلفة: i.cost,
        الربح: i.profit,
        "الهامش %": Number(i.margin ?? 0).toFixed(1),
        المدفوع: i.paid_amount,
        المتبقي: i.remaining,
        "دقة التكلفة": accuracyAr(i.accuracy),
      }));
      break;
    case "customers":
      rows = data.map((c) => ({
        العميل: c.name,
        الهاتف: c.phone ?? "",
        الفواتير: c.invoice_count,
        "صافي المبيعات": c.revenue,
        التكلفة: c.cost,
        الربح: c.profit,
        "الهامش %": Number(c.margin ?? 0).toFixed(1),
        المحصل: c.collected,
        المتبقي: c.remaining,
        "الرصيد الحالي": c.balance,
        "دقة التكلفة": accuracyAr(c.accuracy),
      }));
      break;
    case "products":
      rows = data.map((p) => ({
        الصنف: p.name,
        الكود: p.sku,
        الفئة: p.category,
        "الكمية المباعة": p.qty_sold,
        الإيراد: p.revenue,
        الربح: p.profit,
        "الهامش %": Number(p.margin ?? 0).toFixed(1),
        المخزون: p.stock_qty,
        "قيمة المخزون": p.stock_value,
        الحالة:
          p.stock_status === "out"
            ? "نافد"
            : p.stock_status === "low"
              ? "منخفض"
              : "متوفر",
      }));
      break;
    case "treasury":
      rows = data.map((t) => ({
        الخزنة: t.safe?.name ?? "",
        النوع:
          t.type === "deposit"
            ? "إيداع"
            : t.type === "withdrawal"
              ? "سحب"
              : "تحويل",
        المبلغ: t.amount,
        الوصف: t.description ?? "",
        التاريخ: t.created_at ? formatDateShort(t.created_at) : "",
      }));
      break;
    case "expenses":
      rows = data.map((e) => ({
        "رقم القيد": e.entry_number,
        التاريخ: e.date ? formatDateShort(e.date) : "",
        "كود الحساب": e.expense_account_code ?? "",
        الحساب: e.expense_account_name ?? "",
        الخزنة: e.safe_name ?? "",
        المبلغ: e.amount,
        البيان: e.description ?? "",
      }));
      break;
  }

  exportRows(rows, LABELS[section], LABELS[section]);
}

/** @deprecated use exportReportSection */
export type ReportType = "sales" | "inventory" | "customers" | "treasury";

export function exportReportRows(type: ReportType, data: any[]): void {
  const map: Record<ReportType, ReportSection> = {
    sales: "invoices",
    inventory: "products",
    customers: "customers",
    treasury: "treasury",
  };
  exportReportSection(map[type], data);
}
