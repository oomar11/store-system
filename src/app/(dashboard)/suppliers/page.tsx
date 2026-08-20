"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateShort, smartSearchMatch } from "@/lib/utils";
import { computeNetBalance } from "@/lib/party-link";
import { useSort } from "@/hooks/useSort";
import { useUrlSearchTerm } from "@/hooks/useUrlSearchTerm";
import { SortableHeader } from "@/components/ui/SortableHeader";
import { TableRowActions, type RowAction } from "@/components/ui/TableRowActions";
import { BulkActionBar } from "@/components/ui/BulkActionBar";
import { useRowContextMenu, toContextMenuItems } from "@/components/ui/ContextMenu";
import { Modal } from "@/components/ui/Modal";
import { PrintReportPreview } from "@/components/print/PrintReportPreview";
import { EntityStatementPreview } from "@/components/print/EntityStatementPreview";
import { PartyStatementPreview } from "@/components/print/PartyStatementPreview";
import { PrintListButton } from "@/components/print/PrintListButton";
import { supplierListColumns } from "@/components/print/report-columns";
import { ExcelToolbar } from "@/components/excel/ExcelToolbar";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { guardSupplierDelete } from "@/lib/delete-guards";
import { logAuditEvent } from "@/lib/audit";
import { setEntitiesActive } from "@/lib/active-status";
import {
  getSnapshot,
  isBrowserOnline,
  readLocalThenNetwork,
  withTimeout,
} from "@/lib/offline";
import type { Settings, Supplier } from "@/types";
import { Truck } from "lucide-react";

export default function SuppliersPage() {
  const router = useRouter();
  const { canAccessSuppliers } = useAuth();
  const { confirm } = useConfirm();
  const { error: toastError, info: toastInfo, success: toastSuccess } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [linkedCustomerBalances, setLinkedCustomerBalances] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [searchTerm, setSearchTerm] = useUrlSearchTerm();
  const [balanceStatus, setBalanceStatus] = useState("");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">(
    "active"
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showListPrint, setShowListPrint] = useState(false);
  const [statementSupplier, setStatementSupplier] = useState<Supplier | null>(null);
  const [detailedStatementSupplier, setDetailedStatementSupplier] =
    useState<Supplier | null>(null);
  const supabase = createClient();
  const { openMenu, menu: contextMenu } = useRowContextMenu();

  useEffect(() => {
    fetchSuppliers();
  }, []);

  async function fetchSuppliers() {
    const offline = !isBrowserOnline();

    await readLocalThenNetwork<{
      suppliers: Supplier[];
      linkedCustomerBalances: Record<string, number>;
      settings: Settings | null;
    }>({
      offline,
      timeoutMs: 5000,
      local: async () => {
        const snap = await getSnapshot();
        if (!snap?.suppliers?.length && !snap?.settings) return null;
        const customerBal: Record<string, number> = {};
        for (const c of snap.customers || []) {
          customerBal[c.id] = Number(c.balance) || 0;
        }
        return {
          suppliers: (snap.suppliers || []).map(
            (s) =>
              ({
                id: s.id,
                name: s.name,
                phone: s.phone || undefined,
                balance: s.balance,
                linked_customer_id: s.linked_customer_id ?? null,
                is_active: s.is_active !== false,
                last_activity_at: s.last_activity_at ?? null,
                created_at: "",
              }) as Supplier
          ),
          linkedCustomerBalances: customerBal,
          settings: (snap.settings as Settings | null) ?? null,
        };
      },
      network: async () => {
        const [supRes, settingsRes, custRes] = await withTimeout(
          Promise.all([
            supabase
              .from("suppliers")
              .select("*")
              .order("created_at", { ascending: false }),
            supabase.from("settings").select("*").limit(1).maybeSingle(),
            supabase.from("customers").select("id, balance"),
          ]),
          5000
        );
        if (supRes.error) throw supRes.error;
        const customerBal: Record<string, number> = {};
        for (const c of custRes.data || []) {
          customerBal[c.id as string] = Number(c.balance) || 0;
        }
        return {
          suppliers: (supRes.data as Supplier[]) || [],
          linkedCustomerBalances: customerBal,
          settings: (settingsRes.data as Settings | null) ?? null,
        };
      },
      apply: (data) => {
        setSuppliers(data.suppliers);
        setLinkedCustomerBalances(data.linkedCustomerBalances || {});
        if (data.settings) setSettings(data.settings);
      },
    });

    setLoading(false);
  }

  async function handleDelete(id: string) {
    const supplier = suppliers.find((s) => s.id === id);
    const guard = await guardSupplierDelete(supabase, id, supplier?.name);
    if (!guard.ok) {
      toastError(guard.message);
      return;
    }
    if (
      !(await confirm({
        message: "هل أنت متأكد من حذف هذا المورد؟ لا يمكن التراجع بعد الحذف.",
        tone: "danger",
        confirmLabel: "حذف",
      }))
    )
      return;
    const { suppliersRepo, isLikelyOnline } = await import("@/lib/offline");
    await suppliersRepo.remove(id);
    if (isLikelyOnline()) {
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) {
        toastError(error.message || "تعذر حذف المورد من السيرفر — سيُعاد عند المزامنة");
      } else {
        await logAuditEvent(supabase, {
          action: "supplier.delete",
          entityType: "supplier",
          entityId: id,
          entityLabel: supplier?.name || id,
          before: supplier
            ? { name: supplier.name, balance: supplier.balance }
            : null,
          source: "app",
        });
      }
    }
    setSuppliers(suppliers.filter((s) => s.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function toggleActive(supplier: Supplier) {
    const next = supplier.is_active === false;
    const label = next ? "تفعيل" : "إيقاف";
    if (
      !next &&
      !(await confirm({
        message: `إيقاف «${supplier.name}»؟ لن يظهر في المشتريات والفواتير الجديدة.`,
        tone: "danger",
        confirmLabel: "إيقاف",
      }))
    ) {
      return;
    }
    setSuppliers((prev) =>
      prev.map((s) => (s.id === supplier.id ? { ...s, is_active: next } : s))
    );
    const { error } = await setEntitiesActive(
      supabase,
      "suppliers",
      [supplier.id],
      next,
      { [supplier.id]: supplier.name }
    );
    if (error) {
      setSuppliers((prev) =>
        prev.map((s) =>
          s.id === supplier.id ? { ...s, is_active: supplier.is_active } : s
        )
      );
      toastError(`تعذر ${label} المورد: ${error}`);
    } else {
      toastSuccess(next ? "تم تفعيل المورد" : "تم إيقاف المورد");
    }
  }

  async function bulkSetActive(active: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !active &&
      !(await confirm({
        message: `إيقاف ${ids.length} مورد؟ لن يظهروا في المشتريات والفواتير الجديدة.`,
        tone: "danger",
        confirmLabel: "إيقاف",
      }))
    ) {
      return;
    }
    setBulkBusy(true);
    const labels: Record<string, string> = {};
    for (const s of suppliers) {
      if (selectedIds.has(s.id)) labels[s.id] = s.name;
    }
    setSuppliers((prev) =>
      prev.map((s) =>
        selectedIds.has(s.id) ? { ...s, is_active: active } : s
      )
    );
    const { error, updated } = await setEntitiesActive(
      supabase,
      "suppliers",
      ids,
      active,
      labels
    );
    setBulkBusy(false);
    if (error) {
      toastError(error);
      await fetchSuppliers();
      return;
    }
    toastSuccess(
      active ? `تم تفعيل ${updated} مورد` : `تم إيقاف ${updated} مورد`
    );
    setSelectedIds(new Set());
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !(await confirm({
        message: `حذف ${ids.length} مورد؟ لا يمكن التراجع. الموردون المرتبطون بفواتير أو دفعات سيُتخطون.`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }
    setBulkBusy(true);
    const { suppliersRepo, isLikelyOnline } = await import("@/lib/offline");
    const online = isLikelyOnline();
    let deleted = 0;
    let skipped = 0;
    const deletedIds = new Set<string>();

    for (const id of ids) {
      const supplier = suppliers.find((s) => s.id === id);
      const guard = await guardSupplierDelete(supabase, id, supplier?.name);
      if (!guard.ok) {
        skipped++;
        continue;
      }
      await suppliersRepo.remove(id);
      if (online) {
        const { error } = await supabase.from("suppliers").delete().eq("id", id);
        if (error) {
          skipped++;
          continue;
        }
        await logAuditEvent(supabase, {
          action: "supplier.delete",
          entityType: "supplier",
          entityId: id,
          entityLabel: supplier?.name || id,
          before: supplier
            ? { name: supplier.name, balance: supplier.balance }
            : null,
          source: "app",
        });
      }
      deletedIds.add(id);
      deleted++;
    }

    setSuppliers((prev) => prev.filter((s) => !deletedIds.has(s.id)));
    setSelectedIds(new Set());
    setBulkBusy(false);

    if (deleted > 0 && skipped === 0) {
      toastSuccess(`تم حذف ${deleted} مورد`);
    } else if (deleted > 0) {
      toastInfo(`تم حذف ${deleted}، وتعذر حذف ${skipped}`);
    } else {
      toastError(`تعذر حذف الموردين المحددين (${skipped})`);
    }
  }

  function supplierRowActions(supplier: Supplier): RowAction[] {
    const active = supplier.is_active !== false;
    return [
      {
        label: "كشف حساب",
        tone: "print",
        icon: "printer",
        onClick: () => setStatementSupplier(supplier),
      },
      {
        label: "كشف حساب مفصّل",
        tone: "print",
        icon: "printer",
        onClick: () => setDetailedStatementSupplier(supplier),
      },
      {
        label: "حركة",
        tone: "history",
        icon: "history",
        onClick: () => router.push(`/suppliers/${supplier.id}`),
      },
      ...(canAccessSuppliers
        ? [
            {
              label: "تعديل",
              tone: "edit" as const,
              icon: "pencil" as const,
              onClick: () => {
                setEditingSupplier(supplier);
                setShowForm(true);
              },
            },
            {
              label: active ? "إيقاف" : "تفعيل",
              tone: "toggle" as const,
              icon: "power" as const,
              onClick: () => void toggleActive(supplier),
            },
            {
              label: "حذف",
              tone: "delete" as const,
              icon: "trash" as const,
              onClick: () => void handleDelete(supplier.id),
            },
          ]
        : []),
    ];
  }

  const filteredSuppliers = suppliers.filter((s) => {
    const matchesSearch = smartSearchMatch(searchTerm, [s.name, s.phone, s.email]);
    let matchesBalance = true;
    if (balanceStatus === "debt") {
      matchesBalance = s.balance > 0;
    } else if (balanceStatus === "credit") {
      matchesBalance = s.balance < 0;
    } else if (balanceStatus === "zero") {
      matchesBalance = s.balance === 0;
    }
    let matchesActive = true;
    if (activeFilter === "active") {
      matchesActive = s.is_active !== false;
    } else if (activeFilter === "inactive") {
      matchesActive = s.is_active === false;
    }
    return matchesSearch && matchesBalance && matchesActive;
  });

  const { items: sortedSuppliers, sortConfig, requestSort } = useSort(filteredSuppliers);

  const totalDebts = sortedSuppliers.filter(s => s.balance > 0).reduce((sum, s) => sum + s.balance, 0);
  const totalCredits = sortedSuppliers.filter(s => s.balance < 0).reduce((sum, s) => sum + Math.abs(s.balance), 0);
  const netBalance = sortedSuppliers.reduce((sum, s) => sum + s.balance, 0);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">الموردين</h1>
        <div className="flex flex-wrap gap-2">
          <PrintListButton
            onClick={() => setShowListPrint(true)}
            rowCount={sortedSuppliers.length}
            label="طباعة القائمة"
          />
          <ExcelToolbar
            entity="suppliers"
            exportDisabled={sortedSuppliers.length === 0}
            suppliers={suppliers}
            exportSuppliers={sortedSuppliers}
            allowImport={canAccessSuppliers}
            onImported={fetchSuppliers}
          />
          {canAccessSuppliers && (
            <button
              onClick={() => {
                setEditingSupplier(null);
                setShowForm(true);
              }}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              + إضافة مورد
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="بحث بالاسم أو الهاتف..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 max-w-md rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
        <select
          value={balanceStatus}
          onChange={(e) => setBalanceStatus(e.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">كل الموردين</option>
          <option value="debt">علينا مديونية لهم (علينا)</option>
          <option value="credit">لنا رصيد لديهم (لنا)</option>
          <option value="zero">رصيد صفر</option>
        </select>
        <select
          value={activeFilter}
          onChange={(e) =>
            setActiveFilter(e.target.value as "active" | "inactive" | "all")
          }
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="active">النشطون</option>
          <option value="inactive">الموقوفون</option>
          <option value="all">الكل</option>
        </select>
      </div>

      {canAccessSuppliers && (
        <BulkActionBar
          count={selectedIds.size}
          onClear={() => setSelectedIds(new Set())}
          actions={[
            {
              label: "تفعيل",
              tone: "success",
              disabled: bulkBusy,
              onClick: () => void bulkSetActive(true),
            },
            {
              label: "إيقاف",
              tone: "warning",
              disabled: bulkBusy,
              onClick: () => void bulkSetActive(false),
            },
            {
              label: "حذف المحدد",
              tone: "danger",
              disabled: bulkBusy,
              onClick: () => void bulkDelete(),
            },
          ]}
        />
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto xl:overflow-x-visible">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] bg-gray-50/95 backdrop-blur-xs">
              <tr>
                <th className="w-10 px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={
                      sortedSuppliers.length > 0 &&
                      sortedSuppliers.every((s) => selectedIds.has(s.id))
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(sortedSuppliers.map((s) => s.id)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                    title="تحديد الكل"
                  />
                </th>
                <SortableHeader label="الاسم" field="name" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="الهاتف" field="phone" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="العنوان" field="address" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="الرصيد" field="balance" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="آخر تعامل" field="last_activity_at" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <th className="px-4 py-3 text-right font-medium text-gray-700">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedSuppliers.map((supplier) => {
                const active = supplier.is_active !== false;
                return (
                <tr
                  key={supplier.id}
                  className={`hover:bg-gray-50 ${active ? "" : "bg-gray-50/80 opacity-75"}`}
                  onContextMenu={(e) =>
                    openMenu(e, toContextMenuItems(supplierRowActions(supplier)))
                  }
                >
                  <td className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(supplier.id)}
                      onChange={(e) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(supplier.id);
                          else next.delete(supplier.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/suppliers/${supplier.id}`}
                        className="text-[#1473e6] hover:underline"
                      >
                        {supplier.name}
                      </Link>
                      {supplier.linked_customer_id ? (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-800">
                          عميل+مورد
                        </span>
                      ) : null}
                      {!active && (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-bold text-gray-600">
                          موقوف
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600" dir="ltr">
                    {supplier.phone || "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {supplier.address || "-"}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      if (supplier.linked_customer_id) {
                        const net = computeNetBalance(
                          linkedCustomerBalances[supplier.linked_customer_id] ?? 0,
                          supplier.balance
                        );
                        return (
                          <span
                            className={`font-medium ${
                              net.side === "us"
                                ? "text-red-600"
                                : net.side === "them"
                                  ? "text-green-600"
                                  : "text-gray-600"
                            }`}
                          >
                            {net.label}
                          </span>
                        );
                      }
                      return (
                        <span
                          className={`${
                            supplier.balance !== 0 ? "font-bold" : "font-medium"
                          } ${
                            supplier.balance > 0
                              ? "text-red-600"
                              : supplier.balance < 0
                                ? "text-green-600"
                                : "text-gray-600"
                          }`}
                        >
                          {formatCurrency(Math.abs(supplier.balance))}
                          {supplier.balance > 0 && " (علينا)"}
                          {supplier.balance < 0 && " (لنا)"}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {supplier.last_activity_at
                      ? formatDateShort(supplier.last_activity_at)
                      : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <TableRowActions actions={supplierRowActions(supplier)} />
                  </td>
                </tr>
                );
              })}
              {sortedSuppliers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    {suppliers.length === 0 ? (
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-gray-500">
                        <Truck className="h-10 w-10 text-gray-300" />
                        <p className="text-sm font-medium text-gray-700">
                          لا يوجد موردين بعد
                        </p>
                        <p className="text-xs text-gray-500">
                          أضف مورداً يدوياً أو استورد قائمة من Excel
                        </p>
                        {canAccessSuppliers && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSupplier(null);
                              setShowForm(true);
                            }}
                            className="mt-1 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                          >
                            + إضافة أول مورد
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">
                        لا توجد نتائج مطابقة للبحث أو الفلتر
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
            {sortedSuppliers.length > 0 && (
              <tfoot className="sticky bottom-0 bg-gray-50 font-bold border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-10">
                <tr className="bg-gray-50/95 backdrop-blur-xs text-gray-900">
                  <td></td>
                  <td className="px-4 py-3 font-semibold text-gray-700">إجمالي المعروض ({sortedSuppliers.length})</td>
                  <td colSpan={2}></td>
                  <td className="px-4 py-3 font-semibold">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-red-600 text-xs font-semibold">إجمالي علينا: {formatCurrency(totalDebts)}</span>
                      <span className="text-green-700 text-xs font-semibold">إجمالي لنا: {formatCurrency(totalCredits)}</span>
                      <span className={`text-sm font-bold ${netBalance > 0 ? "text-red-600" : netBalance < 0 ? "text-green-700" : "text-gray-700"}`}>
                        الصافي: {formatCurrency(Math.abs(netBalance))} {netBalance > 0 ? "(علينا)" : netBalance < 0 ? "(لنا)" : ""}
                      </span>
                    </div>
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {showListPrint && (
        <PrintReportPreview
          title="تقرير الموردين"
          rows={sortedSuppliers}
          columns={supplierListColumns}
          settings={settings}
          summary={[
            { label: "العدد", value: String(sortedSuppliers.length) },
            { label: "علينا", value: formatCurrency(totalDebts) },
            { label: "لنا", value: formatCurrency(totalCredits) },
            { label: "الصافي", value: formatCurrency(Math.abs(netBalance)) },
          ]}
          onClose={() => setShowListPrint(false)}
        />
      )}

      {statementSupplier && (
        <EntityStatementPreview
          kind="supplier"
          party={statementSupplier}
          settings={settings}
          onClose={() => setStatementSupplier(null)}
        />
      )}

      {detailedStatementSupplier && (
        <PartyStatementPreview
          kind="supplier"
          partyId={detailedStatementSupplier.id}
          partyName={detailedStatementSupplier.name}
          settings={settings}
          onClose={() => setDetailedStatementSupplier(null)}
        />
      )}

      {showForm && (
        <SupplierForm
          supplier={editingSupplier}
          onClose={() => setShowForm(false)}
          onSave={() => {
            setShowForm(false);
            fetchSuppliers();
          }}
        />
      )}
      {contextMenu}
    </div>
  );
}

function SupplierForm({
  supplier,
  onClose,
  onSave,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const opening = supplier?.opening_balance ?? 0;
  const [form, setForm] = useState({
    name: supplier?.name || "",
    phone: supplier?.phone || "",
    email: supplier?.email || "",
    address: supplier?.address || "",
    notes: supplier?.notes || "",
    openingAmount: Math.abs(opening).toString(),
    openingSide: (opening < 0 ? "credit" : "debt") as "debt" | "credit",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const amount = Math.abs(Number(form.openingAmount) || 0);
    const opening_balance = form.openingSide === "credit" ? -amount : amount;

    const data: Record<string, unknown> = {
      name: form.name,
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      notes: form.notes || null,
      opening_balance,
    };

    if (supplier) {
      const oldOpening = supplier.opening_balance ?? 0;
      data.balance = (supplier.balance || 0) + (opening_balance - oldOpening);
      const { error: updateError } = await supabase
        .from("suppliers")
        .update(data)
        .eq("id", supplier.id);
      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }
    } else {
      data.balance = opening_balance;
      const { error: insertError } = await supabase.from("suppliers").insert(data);
      if (insertError) {
        setError(insertError.message);
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    onSave();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={supplier ? "تعديل مورد" : "إضافة مورد جديد"}
    >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              الاسم *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              الهاتف
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              البريد الإلكتروني
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              العنوان
            </label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              الرصيد الابتدائي
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.openingAmount}
                onChange={(e) => setForm({ ...form, openingAmount: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                dir="ltr"
              />
              <select
                value={form.openingSide}
                onChange={(e) =>
                  setForm({ ...form, openingSide: e.target.value as "debt" | "credit" })
                }
                className="min-w-[110px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="debt">علينا</option>
                <option value="credit">لنا</option>
              </select>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {supplier
                ? "تعديل الرصيد الابتدائي يحدّث الرصيد الحالي بنفس الفرق دون إلغاء الحركات السابقة."
                : "علينا = دين للمورد · لنا = رصيد مدفوع مقدماً"}
            </p>
            {supplier && (
              <p className="mt-1 text-xs text-gray-600">
                الرصيد الحالي: {formatCurrency(Math.abs(supplier.balance))}
                {supplier.balance > 0 ? " (علينا)" : supplier.balance < 0 ? " (لنا)" : ""}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              ملاحظات
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {loading ? "جاري الحفظ..." : supplier ? "تحديث" : "إضافة"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              إلغاء
            </button>
          </div>
        </form>
    </Modal>
  );
}
