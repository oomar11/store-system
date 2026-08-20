"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateShort, smartSearchMatch } from "@/lib/utils";
import { computeNetBalance } from "@/lib/party-link";
import { listPriceTiers } from "@/lib/price-tiers";
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
import { customerListColumns } from "@/components/print/report-columns";
import { ExcelToolbar } from "@/components/excel/ExcelToolbar";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { guardCustomerDelete } from "@/lib/delete-guards";
import { logAuditEvent } from "@/lib/audit";
import { setEntitiesActive } from "@/lib/active-status";
import {
  getSnapshot,
  isBrowserOnline,
  readLocalThenNetwork,
  withTimeout,
} from "@/lib/offline";
import type { Customer, PriceTier, Settings } from "@/types";
import { Users } from "lucide-react";
import {
  BusinessLineBadges,
  BusinessLineEditor,
} from "@/components/parties/BusinessLineBadges";
import {
  normalizeBusinessLines,
  type BusinessLine,
} from "@/lib/business-lines";
import {
  businessLinesFromNotes,
  hydrateCustomersBusinessLines,
  saveCustomerBusinessLinesManual,
} from "@/lib/customer-business-lines";

export default function CustomersPage() {
  const router = useRouter();
  const { canWriteCustomers } = useAuth();
  const { confirm } = useConfirm();
  const { error: toastError, info: toastInfo, success: toastSuccess } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [linkedSupplierBalances, setLinkedSupplierBalances] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [searchTerm, setSearchTerm] = useUrlSearchTerm();
  const [balanceStatus, setBalanceStatus] = useState("");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">(
    "active"
  );
  const [lineFilter, setLineFilter] = useState<
    "" | BusinessLine | "multi"
  >("");
  const [schemaReady, setSchemaReady] = useState<boolean | null>(null);
  const [schemaBusy, setSchemaBusy] = useState(false);
  const [schemaSqlEditor, setSchemaSqlEditor] = useState(
    "https://supabase.com/dashboard/project/qcvhddjvftpjczdxcfjz/sql/new"
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showListPrint, setShowListPrint] = useState(false);
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);
  const [detailedStatementCustomer, setDetailedStatementCustomer] =
    useState<Customer | null>(null);
  const supabase = createClient();
  const { openMenu, menu: contextMenu } = useRowContextMenu();

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/customers/ensure-business-lines", {
          cache: "no-store",
        });
        const json = (await res.json()) as {
          ready?: boolean;
          sqlEditor?: string;
        };
        if (cancelled) return;
        setSchemaReady(json.ready === true);
        if (json.sqlEditor) setSchemaSqlEditor(json.sqlEditor);
      } catch {
        if (!cancelled) setSchemaReady(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function activateBusinessLinesSchema() {
    setSchemaBusy(true);
    try {
      const res = await fetch("/api/customers/ensure-business-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate" }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        ready?: boolean;
        applied?: boolean;
        error?: string;
        message?: string;
        sqlEditor?: string;
        backfill?: { updated?: number; scanned?: number; mode?: string };
      };
      if (json.sqlEditor) setSchemaSqlEditor(json.sqlEditor);
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "تعذر تفعيل التصنيف");
      }
      setSchemaReady(json.ready === true);
      toastSuccess(
        json.message ||
          (json.ready
            ? "تم تفعيل تصنيف العملاء"
            : `تم تفعيل التصنيف (${json.backfill?.updated || 0} عميل)`)
      );
      await fetchCustomers();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر تفعيل التصنيف");
    } finally {
      setSchemaBusy(false);
    }
  }

  async function fetchCustomers() {
    const offline = !isBrowserOnline();

    await readLocalThenNetwork<{
      customers: Customer[];
      linkedSupplierBalances: Record<string, number>;
      settings: Settings | null;
    }>({
      offline,
      timeoutMs: 5000,
      local: async () => {
        const snap = await getSnapshot();
        if (!snap?.customers?.length && !snap?.settings) return null;
        const supplierBal: Record<string, number> = {};
        for (const s of snap.suppliers || []) {
          supplierBal[s.id] = Number(s.balance) || 0;
        }
        return {
          customers: (snap.customers || []).map(
            (c) =>
              ({
                id: c.id,
                name: c.name,
                phone: c.phone || undefined,
                balance: c.balance,
                price_tier_id: c.price_tier_id ?? null,
                linked_supplier_id: c.linked_supplier_id ?? null,
                business_lines: normalizeBusinessLines(
                  c.business_lines?.length
                    ? c.business_lines
                    : businessLinesFromNotes(
                        (c as { notes?: string | null }).notes
                      )
                ),
                business_lines_locked: c.business_lines_locked === true,
                is_active: c.is_active !== false,
                last_activity_at: c.last_activity_at ?? null,
                created_at: "",
              }) as Customer
          ),
          linkedSupplierBalances: supplierBal,
          settings: (snap.settings as Settings | null) ?? null,
        };
      },
      network: async () => {
        const [custRes, settingsRes, suppRes] = await withTimeout(
          Promise.all([
            supabase
              .from("customers")
              .select("*")
              .order("created_at", { ascending: false }),
            supabase.from("settings").select("*").limit(1).maybeSingle(),
            supabase.from("suppliers").select("id, balance"),
          ]),
          5000
        );
        if (custRes.error) throw custRes.error;
        const supplierBal: Record<string, number> = {};
        for (const s of suppRes.data || []) {
          supplierBal[s.id as string] = Number(s.balance) || 0;
        }
        const customers = await hydrateCustomersBusinessLines(
          supabase,
          (custRes.data as Customer[]) || []
        );
        return {
          customers,
          linkedSupplierBalances: supplierBal,
          settings: (settingsRes.data as Settings | null) ?? null,
        };
      },
      apply: (data) => {
        setCustomers(data.customers);
        setLinkedSupplierBalances(data.linkedSupplierBalances || {});
        if (data.settings) setSettings(data.settings);
      },
    });

    setLoading(false);
  }

  async function handleDelete(id: string) {
    const customer = customers.find((c) => c.id === id);
    const guard = await guardCustomerDelete(supabase, id, customer?.name);
    if (!guard.ok) {
      toastError(guard.message);
      return;
    }
    if (
      !(await confirm({
        message: "هل أنت متأكد من حذف هذا العميل؟ لا يمكن التراجع بعد الحذف.",
        tone: "danger",
        confirmLabel: "حذف",
      }))
    )
      return;
    const { customersRepo, isLikelyOnline } = await import("@/lib/offline");
    await customersRepo.remove(id);
    if (isLikelyOnline()) {
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) {
        toastError(error.message || "تعذر حذف العميل من السيرفر — سيُعاد عند المزامنة");
      } else {
        await logAuditEvent(supabase, {
          action: "customer.delete",
          entityType: "customer",
          entityId: id,
          entityLabel: customer?.name || id,
          before: customer
            ? { name: customer.name, balance: customer.balance }
            : null,
          source: "app",
        });
      }
    }
    setCustomers(customers.filter((c) => c.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function toggleActive(customer: Customer) {
    const next = customer.is_active === false;
    const label = next ? "تفعيل" : "إيقاف";
    if (
      !next &&
      !(await confirm({
        message: `إيقاف «${customer.name}»؟ لن يظهر في نقطة البيع والفواتير الجديدة.`,
        tone: "danger",
        confirmLabel: "إيقاف",
      }))
    ) {
      return;
    }
    setCustomers((prev) =>
      prev.map((c) => (c.id === customer.id ? { ...c, is_active: next } : c))
    );
    const { error } = await setEntitiesActive(
      supabase,
      "customers",
      [customer.id],
      next,
      { [customer.id]: customer.name }
    );
    if (error) {
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === customer.id ? { ...c, is_active: customer.is_active } : c
        )
      );
      toastError(`تعذر ${label} العميل: ${error}`);
    } else {
      toastSuccess(next ? "تم تفعيل العميل" : "تم إيقاف العميل");
    }
  }

  async function bulkSetActive(active: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !active &&
      !(await confirm({
        message: `إيقاف ${ids.length} عميل؟ لن يظهروا في نقطة البيع والفواتير الجديدة.`,
        tone: "danger",
        confirmLabel: "إيقاف",
      }))
    ) {
      return;
    }
    setBulkBusy(true);
    const labels: Record<string, string> = {};
    for (const c of customers) {
      if (selectedIds.has(c.id)) labels[c.id] = c.name;
    }
    setCustomers((prev) =>
      prev.map((c) =>
        selectedIds.has(c.id) ? { ...c, is_active: active } : c
      )
    );
    const { error, updated } = await setEntitiesActive(
      supabase,
      "customers",
      ids,
      active,
      labels
    );
    setBulkBusy(false);
    if (error) {
      toastError(error);
      await fetchCustomers();
      return;
    }
    toastSuccess(
      active ? `تم تفعيل ${updated} عميل` : `تم إيقاف ${updated} عميل`
    );
    setSelectedIds(new Set());
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !(await confirm({
        message: `حذف ${ids.length} عميل؟ لا يمكن التراجع. العملاء المرتبطون بفواتير أو دفعات سيُتخطون.`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }
    setBulkBusy(true);
    const { customersRepo, isLikelyOnline } = await import("@/lib/offline");
    const online = isLikelyOnline();
    let deleted = 0;
    let skipped = 0;
    const deletedIds = new Set<string>();

    for (const id of ids) {
      const customer = customers.find((c) => c.id === id);
      const guard = await guardCustomerDelete(supabase, id, customer?.name);
      if (!guard.ok) {
        skipped++;
        continue;
      }
      await customersRepo.remove(id);
      if (online) {
        const { error } = await supabase.from("customers").delete().eq("id", id);
        if (error) {
          skipped++;
          continue;
        }
        await logAuditEvent(supabase, {
          action: "customer.delete",
          entityType: "customer",
          entityId: id,
          entityLabel: customer?.name || id,
          before: customer
            ? { name: customer.name, balance: customer.balance }
            : null,
          source: "app",
        });
      }
      deletedIds.add(id);
      deleted++;
    }

    setCustomers((prev) => prev.filter((c) => !deletedIds.has(c.id)));
    setSelectedIds(new Set());
    setBulkBusy(false);

    if (deleted > 0 && skipped === 0) {
      toastSuccess(`تم حذف ${deleted} عميل`);
    } else if (deleted > 0) {
      toastInfo(`تم حذف ${deleted}، وتعذر حذف ${skipped}`);
    } else {
      toastError(`تعذر حذف العملاء المحددين (${skipped})`);
    }
  }

  function customerRowActions(customer: Customer): RowAction[] {
    const active = customer.is_active !== false;
    return [
      {
        label: "كشف حساب",
        tone: "print",
        icon: "printer",
        onClick: () => setStatementCustomer(customer),
      },
      {
        label: "كشف حساب مفصّل",
        tone: "print",
        icon: "printer",
        onClick: () => setDetailedStatementCustomer(customer),
      },
      {
        label: "حركة",
        tone: "history",
        icon: "history",
        onClick: () => router.push(`/customers/${customer.id}`),
      },
      ...(canWriteCustomers
        ? [
            {
              label: "تعديل",
              tone: "edit" as const,
              icon: "pencil" as const,
              onClick: () => {
                setEditingCustomer(customer);
                setShowForm(true);
              },
            },
            {
              label: active ? "إيقاف" : "تفعيل",
              tone: "toggle" as const,
              icon: "power" as const,
              onClick: () => void toggleActive(customer),
            },
            {
              label: "حذف",
              tone: "delete" as const,
              icon: "trash" as const,
              onClick: () => void handleDelete(customer.id),
            },
          ]
        : []),
    ];
  }

  const filteredCustomers = customers.filter((c) => {
    const matchesSearch = smartSearchMatch(searchTerm, [c.name, c.phone, c.email]);
    let matchesBalance = true;
    if (balanceStatus === "debtor") {
      matchesBalance = c.balance > 0;
    } else if (balanceStatus === "creditor") {
      matchesBalance = c.balance < 0;
    } else if (balanceStatus === "zero") {
      matchesBalance = c.balance === 0;
    }
    let matchesActive = true;
    if (activeFilter === "active") {
      matchesActive = c.is_active !== false;
    } else if (activeFilter === "inactive") {
      matchesActive = c.is_active === false;
    }
    let matchesLine = true;
    const lines = normalizeBusinessLines(c.business_lines);
    if (lineFilter === "multi") {
      matchesLine = lines.length > 1;
    } else if (lineFilter) {
      matchesLine = lines.includes(lineFilter);
    }
    return matchesSearch && matchesBalance && matchesActive && matchesLine;
  });

  const { items: sortedCustomers, sortConfig, requestSort } = useSort(filteredCustomers);

  const totalDebts = sortedCustomers.filter(c => c.balance > 0).reduce((sum, c) => sum + c.balance, 0);
  const totalCredits = sortedCustomers.filter(c => c.balance < 0).reduce((sum, c) => sum + Math.abs(c.balance), 0);
  const netBalance = sortedCustomers.reduce((sum, c) => sum + c.balance, 0);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
      </div>
    );
  }

  return (
    <div>
      {schemaReady === false ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold">تصنيف العملاء جاهز للتفعيل بضغطة واحدة</p>
              <p className="mt-0.5 text-amber-900/80">
                هيتحدد تلقائي مين سلك / محل / ورشة من التعامل — من غير SQL
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={schemaBusy || !canWriteCustomers}
                onClick={() => void activateBusinessLinesSchema()}
                className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-50"
              >
                {schemaBusy ? "جاري التفعيل…" : "تفعيل التصنيف الآن"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">العملاء</h1>
        <div className="flex flex-wrap gap-2">
          <PrintListButton
            onClick={() => setShowListPrint(true)}
            rowCount={sortedCustomers.length}
            label="طباعة القائمة"
          />
          <ExcelToolbar
            entity="customers"
            exportDisabled={sortedCustomers.length === 0}
            customers={customers}
            exportCustomers={sortedCustomers}
            allowImport={canWriteCustomers}
            onImported={fetchCustomers}
          />
          {canWriteCustomers && (
            <button
              onClick={() => {
                setEditingCustomer(null);
                setShowForm(true);
              }}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              + إضافة عميل
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
          <option value="">كل العملاء</option>
          <option value="debtor">عليهم مديونية (مدين)</option>
          <option value="creditor">لهم رصيد (دائن)</option>
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
        <select
          value={lineFilter}
          onChange={(e) =>
            setLineFilter(e.target.value as "" | BusinessLine | "multi")
          }
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">كل التصنيفات</option>
          <option value="wire">سلك</option>
          <option value="store">محل</option>
          <option value="workshop">ورشة</option>
          <option value="multi">أكتر من حاجة</option>
        </select>
      </div>

      {canWriteCustomers && (
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
                      sortedCustomers.length > 0 &&
                      sortedCustomers.every((c) => selectedIds.has(c.id))
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(sortedCustomers.map((c) => c.id)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                    title="تحديد الكل"
                  />
                </th>
                <SortableHeader label="الاسم" field="name" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <th className="px-4 py-3 text-right font-medium text-gray-700">التصنيف</th>
                <SortableHeader label="الهاتف" field="phone" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="العنوان" field="address" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="الرصيد" field="balance" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="آخر تعامل" field="last_activity_at" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <th className="px-4 py-3 text-right font-medium text-gray-700">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedCustomers.map((customer) => {
                const active = customer.is_active !== false;
                return (
                <tr
                  key={customer.id}
                  className={`hover:bg-gray-50 ${active ? "" : "bg-gray-50/80 opacity-75"}`}
                  onContextMenu={(e) =>
                    openMenu(e, toContextMenuItems(customerRowActions(customer)))
                  }
                >
                  <td className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(customer.id)}
                      onChange={(e) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(customer.id);
                          else next.delete(customer.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/customers/${customer.id}`}
                        className="text-[#1473e6] hover:underline"
                      >
                        {customer.name}
                      </Link>
                      {customer.linked_supplier_id ? (
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
                  <td className="px-4 py-3">
                    <BusinessLineBadges lines={customer.business_lines} />
                  </td>
                  <td className="px-4 py-3 text-gray-600" dir="ltr">
                    {customer.phone || "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {customer.address || "-"}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      if (customer.linked_supplier_id) {
                        const net = computeNetBalance(
                          customer.balance,
                          linkedSupplierBalances[customer.linked_supplier_id] ?? 0
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
                          className={`font-medium ${
                            customer.balance > 0
                              ? "text-red-600"
                              : customer.balance < 0
                                ? "text-green-600"
                                : "text-gray-600"
                          }`}
                        >
                          {formatCurrency(Math.abs(customer.balance))}
                          {customer.balance > 0 && " (عليه)"}
                          {customer.balance < 0 && " (له)"}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {customer.last_activity_at
                      ? formatDateShort(customer.last_activity_at)
                      : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <TableRowActions actions={customerRowActions(customer)} />
                  </td>
                </tr>
                );
              })}
              {sortedCustomers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    {customers.length === 0 ? (
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-gray-500">
                        <Users className="h-10 w-10 text-gray-300" />
                        <p className="text-sm font-medium text-gray-700">
                          لا يوجد عملاء بعد
                        </p>
                        <p className="text-xs text-gray-500">
                          أضف عميلاً يدوياً أو استورد قائمة من Excel
                        </p>
                        {canWriteCustomers && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCustomer(null);
                              setShowForm(true);
                            }}
                            className="mt-1 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                          >
                            + إضافة أول عميل
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
            {sortedCustomers.length > 0 && (
              <tfoot className="sticky bottom-0 bg-gray-50 font-bold border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-10">
                <tr className="bg-gray-50/95 backdrop-blur-xs text-gray-900">
                  <td></td>
                  <td className="px-4 py-3 font-semibold text-gray-700">إجمالي المعروض ({sortedCustomers.length})</td>
                  <td colSpan={2}></td>
                  <td className="px-4 py-3 font-semibold">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-red-600 text-xs font-semibold">إجمالي المدين (عليه): {formatCurrency(totalDebts)}</span>
                      <span className="text-green-700 text-xs font-semibold">إجمالي الدائن (له): {formatCurrency(totalCredits)}</span>
                      <span className={`text-sm font-bold ${netBalance > 0 ? "text-red-600" : netBalance < 0 ? "text-green-700" : "text-gray-700"}`}>
                        الصافي: {formatCurrency(Math.abs(netBalance))} {netBalance > 0 ? "(عليه)" : netBalance < 0 ? "(له)" : ""}
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
          title="تقرير العملاء"
          rows={sortedCustomers}
          columns={customerListColumns}
          settings={settings}
          summary={[
            { label: "العدد", value: String(sortedCustomers.length) },
            { label: "إجمالي المدين", value: formatCurrency(totalDebts) },
            { label: "إجمالي الدائن", value: formatCurrency(totalCredits) },
            { label: "الصافي", value: formatCurrency(Math.abs(netBalance)) },
          ]}
          onClose={() => setShowListPrint(false)}
        />
      )}

      {statementCustomer && (
        <EntityStatementPreview
          kind="customer"
          party={statementCustomer}
          settings={settings}
          onClose={() => setStatementCustomer(null)}
        />
      )}

      {detailedStatementCustomer && (
        <PartyStatementPreview
          kind="customer"
          partyId={detailedStatementCustomer.id}
          partyName={detailedStatementCustomer.name}
          settings={settings}
          onClose={() => setDetailedStatementCustomer(null)}
        />
      )}

      {showForm && (
        <CustomerForm
          customer={editingCustomer}
          onClose={() => setShowForm(false)}
          onSave={() => {
            setShowForm(false);
            fetchCustomers();
          }}
        />
      )}
      {contextMenu}
    </div>
  );
}

function CustomerForm({
  customer,
  onClose,
  onSave,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const opening = customer?.opening_balance ?? 0;
  const [form, setForm] = useState({
    name: customer?.name || "",
    phone: customer?.phone || "",
    email: customer?.email || "",
    address: customer?.address || "",
    notes: customer?.notes || "",
    openingAmount: Math.abs(opening).toString(),
    openingSide: (opening < 0 ? "credit" : "debt") as "debt" | "credit",
    price_tier_id: customer?.price_tier_id || "",
  });
  const [businessLines, setBusinessLines] = useState<BusinessLine[]>(
    normalizeBusinessLines(
      customer?.business_lines?.length
        ? customer.business_lines
        : customer
          ? []
          : ["store"]
    )
  );
  const [tiers, setTiers] = useState<PriceTier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const supabase = createClient();

  useEffect(() => {
    void listPriceTiers(supabase)
      .then(setTiers)
      .catch(() => setTiers([]));
  }, [supabase]);

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
      price_tier_id: form.price_tier_id || null,
    };

    if (customer) {
      const oldOpening = customer.opening_balance ?? 0;
      data.balance = (customer.balance || 0) + (opening_balance - oldOpening);
      const { error: updateError } = await supabase
        .from("customers")
        .update(data)
        .eq("id", customer.id);
      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }
      try {
        await saveCustomerBusinessLinesManual(
          supabase,
          customer.id,
          businessLines,
          { locked: true }
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "تعذر حفظ التصنيف");
        setLoading(false);
        return;
      }
    } else {
      data.balance = opening_balance;
      data.business_lines = businessLines;
      data.business_lines_manual = businessLines;
      data.business_lines_locked = businessLines.length > 0;
      const { data: inserted, error: insertError } = await supabase
        .from("customers")
        .insert(data)
        .select("id")
        .maybeSingle();
      if (insertError) {
        // Columns missing: insert without them, then save via notes fallback
        const missingCols =
          /business_lines/i.test(insertError.message || "");
        if (!missingCols) {
          setError(insertError.message);
          setLoading(false);
          return;
        }
        delete data.business_lines;
        delete data.business_lines_manual;
        delete data.business_lines_locked;
        const { data: inserted2, error: insertError2 } = await supabase
          .from("customers")
          .insert(data)
          .select("id")
          .maybeSingle();
        if (insertError2 || !inserted2?.id) {
          setError(insertError2?.message || "تعذر إضافة العميل");
          setLoading(false);
          return;
        }
        try {
          await saveCustomerBusinessLinesManual(
            supabase,
            inserted2.id,
            businessLines,
            { locked: true }
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : "تعذر حفظ التصنيف");
          setLoading(false);
          return;
        }
      } else if (inserted?.id && businessLines.length > 0) {
        // columns path already set on insert
      }
    }

    setLoading(false);
    onSave();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={customer ? "تعديل عميل" : "إضافة عميل جديد"}
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
              التصنيف
            </label>
            <BusinessLineEditor
              value={businessLines}
              onChange={setBusinessLines}
              disabled={loading}
            />
            <p className="mt-1 text-[10px] text-gray-400">
              سلك = بلسية · محل = المتجر · ورشة = PVC — ممكن أكتر من حاجة
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              شريحة السعر
            </label>
            <select
              value={form.price_tier_id}
              onChange={(e) =>
                setForm({ ...form, price_tier_id: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">تجزئة (الافتراضي)</option>
              {tiers
                .filter((t) => !t.is_default)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-[10px] text-gray-400">
              اختياري: تتحمّل تلقائياً عند اختيار العميل في نقطة البيع. تقدر كمان
              تطبّق أي شريحة على الفاتورة مباشرة بدون عميل.
            </p>
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
                <option value="debt">عليه</option>
                <option value="credit">له</option>
              </select>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {customer
                ? "تعديل الرصيد الابتدائي يحدّث الرصيد الحالي بنفس الفرق دون إلغاء الحركات السابقة."
                : "عليه = دين على العميل · له = رصيد دائن للعميل"}
            </p>
            {customer && (
              <p className="mt-1 text-xs text-gray-600">
                الرصيد الحالي: {formatCurrency(Math.abs(customer.balance))}
                {customer.balance > 0 ? " (عليه)" : customer.balance < 0 ? " (له)" : ""}
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
              {loading ? "جاري الحفظ..." : customer ? "تحديث" : "إضافة"}
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
