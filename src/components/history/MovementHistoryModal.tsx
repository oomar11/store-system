"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import {
  fetchCustomerHistory,
  fetchProductMovements,
  fetchSupplierHistory,
  invoiceTypeLabel,
  movementSign,
  type MovementRow,
  type PartyInvoiceRow,
} from "@/lib/history";

type Kind = "product" | "customer" | "supplier";

interface MovementHistoryModalProps {
  open: boolean;
  onClose: () => void;
  kind: Kind;
  entityId: string;
  entityName: string;
}

export function MovementHistoryModal({
  open,
  onClose,
  kind,
  entityId,
  entityName,
}: MovementHistoryModalProps) {
  const [loading, setLoading] = useState(true);
  const [productRows, setProductRows] = useState<MovementRow[]>([]);
  const [partyRows, setPartyRows] = useState<PartyInvoiceRow[]>([]);

  useEffect(() => {
    if (!open || !entityId) return;
    let cancelled = false;
    setLoading(true);

    async function load() {
      if (kind === "product") {
        const rows = await fetchProductMovements(entityId);
        if (!cancelled) setProductRows(rows);
      } else if (kind === "customer") {
        const rows = await fetchCustomerHistory(entityId);
        if (!cancelled) setPartyRows(rows);
      } else {
        const rows = await fetchSupplierHistory(entityId);
        if (!cancelled) setPartyRows(rows);
      }
      if (!cancelled) setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, entityId, kind]);

  const title =
    kind === "product"
      ? `حركة الصنف: ${entityName}`
      : kind === "customer"
        ? `حركة العميل: ${entityName}`
        : `حركة المورد: ${entityName}`;

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#dcecff] border-t-[#1473e6]" />
        </div>
      ) : kind === "product" ? (
        <ProductTable rows={productRows} />
      ) : (
        <PartyTable rows={partyRows} />
      )}
    </Modal>
  );
}

function ProductTable({ rows }: { rows: MovementRow[] }) {
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-[#687386]">لا توجد حركات مسجلة لهذا الصنف</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#e1e6ee]">
      <table className="w-full text-sm">
        <thead className="bg-[#f3f6fa] text-[#526176]">
          <tr>
            <th className="px-3 py-2.5 text-right font-semibold">التاريخ</th>
            <th className="px-3 py-2.5 text-right font-semibold">المستند</th>
            <th className="px-3 py-2.5 text-right font-semibold">النوع</th>
            <th className="px-3 py-2.5 text-right font-semibold">الطرف</th>
            <th className="px-3 py-2.5 text-right font-semibold">الكمية</th>
            <th className="px-3 py-2.5 text-right font-semibold">الإجمالي</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#eef1f6]">
          {rows.map((row) => {
            const inv = row.invoice!;
            const sign = movementSign(inv.type);
            const party = inv.customer?.name || inv.supplier?.name || "—";
            return (
              <tr key={row.id} className="hover:bg-[#f8fafc]">
                <td className="px-3 py-2.5 text-[#526176]">{formatDateShort(inv.created_at)}</td>
                <td className="px-3 py-2.5 font-mono text-xs font-semibold">{inv.invoice_number}</td>
                <td className="px-3 py-2.5">{invoiceTypeLabel(inv.type)}</td>
                <td className="px-3 py-2.5">{party}</td>
                <td
                  className={`px-3 py-2.5 font-bold ${
                    sign > 0 ? "text-emerald-700" : sign < 0 ? "text-rose-700" : "text-[#172033]"
                  }`}
                >
                  {sign > 0 ? "+" : sign < 0 ? "−" : ""}
                  {row.quantity}
                </td>
                <td className="px-3 py-2.5 font-semibold">{formatCurrency(row.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PartyTable({ rows }: { rows: PartyInvoiceRow[] }) {
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-[#687386]">لا توجد فواتير مسجلة</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#e1e6ee]">
      <table className="w-full text-sm">
        <thead className="bg-[#f3f6fa] text-[#526176]">
          <tr>
            <th className="px-3 py-2.5 text-right font-semibold">التاريخ</th>
            <th className="px-3 py-2.5 text-right font-semibold">رقم الفاتورة</th>
            <th className="px-3 py-2.5 text-right font-semibold">النوع</th>
            <th className="px-3 py-2.5 text-right font-semibold">الإجمالي</th>
            <th className="px-3 py-2.5 text-right font-semibold">المدفوع</th>
            <th className="px-3 py-2.5 text-right font-semibold">الحالة</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#eef1f6]">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-[#f8fafc]">
              <td className="px-3 py-2.5 text-[#526176]">{formatDateShort(row.created_at)}</td>
              <td className="px-3 py-2.5 font-mono text-xs font-semibold">{row.invoice_number}</td>
              <td className="px-3 py-2.5">{invoiceTypeLabel(row.type)}</td>
              <td className="px-3 py-2.5 font-bold">{formatCurrency(row.total)}</td>
              <td className="px-3 py-2.5 text-emerald-700">{formatCurrency(row.paid_amount)}</td>
              <td className="px-3 py-2.5 text-[#687386]">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
