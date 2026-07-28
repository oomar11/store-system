"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateRelative, smartSearchMatch, parseNumberInput } from "@/lib/utils";
import { createInvoiceOnlineOrQueue, getSnapshot, isBrowserOnline, withTimeout } from "@/lib/offline";
import { mapCartToInvoiceItems } from "@/lib/invoice-cost";
import {
  deleteReturnInvoiceFully,
  updateReturnInvoiceFully,
  type ReturnInvoiceRef,
} from "@/lib/invoice-return";
import { safesOrderQuery } from "@/lib/safes-order";
import { useSort } from "@/hooks/useSort";
import { SortableHeader } from "@/components/ui/SortableHeader";
import { Plus, Search, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { DateField } from "@/components/ui/DateField";
import { TodayDateChip } from "@/components/ui/TodayDateChip";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { TableRowActions, type RowAction } from "@/components/ui/TableRowActions";
import { useRowContextMenu, toContextMenuItems } from "@/components/ui/ContextMenu";
import { PrintReportPreview } from "@/components/print/PrintReportPreview";
import { DocumentPrintPreview } from "@/components/print/DocumentPrintPreview";
import { PrintListButton } from "@/components/print/PrintListButton";
import { returnInvoiceColumns } from "@/components/print/report-columns";
import { useAuth } from "@/hooks/useAuth";
import type { Safe, Product, Customer, Supplier, Settings } from "@/types";

interface ReturnLineCart {
  product: Product;
  quantity: number;
  unit_price: number;
  unit_cost: number | null;
  max_quantity: number;
  total: number;
}

type SourceInvoiceRow = {
  id: string;
  invoice_number: string;
  type: "sale" | "purchase";
  created_at: string;
  total: number;
  customer_id?: string | null;
  supplier_id?: string | null;
  customer?: { name?: string } | null;
  supplier?: { name?: string } | null;
};

export function ReturnsPanel({ embedded = false }: { embedded?: boolean }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [returnType, setReturnType] = useState<"sale_return" | "purchase_return">("sale_return");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit">("cash");
  const [selectedSafeId, setSelectedSafeId] = useState("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<ReturnLineCart[]>([]);
  const [formSaving, setFormSaving] = useState(false);

  const [sourceInvoice, setSourceInvoice] = useState<SourceInvoiceRow | null>(null);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceResults, setInvoiceResults] = useState<SourceInvoiceRow[]>([]);
  const [invoiceSearching, setInvoiceSearching] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [editingReturn, setEditingReturn] = useState<ReturnInvoiceRef | null>(null);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [safes, setSafes] = useState<Safe[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showListPrint, setShowListPrint] = useState(false);
  const [docPrint, setDocPrint] = useState<{
    invoice: any;
    originalInvoiceNumber?: string;
    items: {
      name: string;
      sku?: string;
      quantity: number;
      unit_price: number;
      discount: number;
      total: number;
    }[];
    partyName?: string;
    partyPhone?: string;
  } | null>(null);

  const supabase = createClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const { canDeleteInvoices, profile } = useAuth();
  const { openMenu, menu: contextMenu } = useRowContextMenu();

  useEffect(() => {
    fetchReturns();
    fetchLists();
  }, []);

  useEffect(() => {
    if (!showForm) return;
    const q = invoiceSearch.trim();
    if (q.length < 1) {
      setInvoiceResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchSourceInvoices(q);
    }, 250);
    return () => clearTimeout(timer);
  }, [invoiceSearch, returnType, showForm]);

  async function fetchReturns() {
    setLoading(true);
    if (!isBrowserOnline()) {
      setInvoices([]);
      setLoading(false);
      return;
    }
    try {
      const { data } = await withTimeout(
        (async () =>
          supabase
            .from("invoices")
            .select(
              "*, customer:customers(name), supplier:suppliers(name), original_invoice:invoices!original_invoice_id(id, invoice_number, type)"
            )
            .in("type", ["sale_return", "purchase_return"])
            .order("created_at", { ascending: false }))(),
        5000
      );
      if (data) setInvoices(data);
    } catch {
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchLists() {
    if (!isBrowserOnline()) {
      const snap = await getSnapshot();
      if (snap?.customers?.length) {
        setCustomers(
          snap.customers
            .filter((c) => c.is_active !== false)
            .map((c) => ({
              id: c.id,
              name: c.name,
              phone: c.phone,
              balance: c.balance,
            })) as Customer[]
        );
      }
      if (snap?.suppliers?.length) {
        setSuppliers(
          snap.suppliers
            .filter((s) => s.is_active !== false)
            .map((s) => ({
              id: s.id,
              name: s.name,
              phone: s.phone,
              balance: s.balance,
            })) as Supplier[]
        );
      }
      if (snap?.safes?.length) {
        const active = snap.safes.filter((s) => s.is_active) as Safe[];
        setSafes(active);
        if (!selectedSafeId && active[0]?.id) setSelectedSafeId(active[0].id);
      }
      if (snap?.settings) setSettings(snap.settings as unknown as Settings);
      return;
    }
    try {
      const [custRes, suppRes, safeRes, settingsRes] = await withTimeout(
        Promise.all([
          supabase.from("customers").select("*").eq("is_active", true).order("name"),
          supabase.from("suppliers").select("*").eq("is_active", true).order("name"),
          safesOrderQuery(
            supabase.from("safes").select("*").eq("is_active", true)
          ),
          supabase.from("settings").select("*").limit(1).maybeSingle(),
        ]),
        5000
      );

      if (custRes.data) setCustomers(custRes.data);
      if (suppRes.data) setSuppliers(suppRes.data);
      if (safeRes.data) {
        setSafes(safeRes.data);
        if (!selectedSafeId && safeRes.data[0]?.id) {
          setSelectedSafeId(safeRes.data[0].id);
        }
      }
      if (settingsRes.data) setSettings(settingsRes.data);
    } catch {
      /* keep prior lists */
    }
  }

  async function searchSourceInvoices(term: string) {
    setInvoiceSearching(true);
    const sourceType = returnType === "sale_return" ? "sale" : "purchase";
    const { data, error } = await supabase
      .from("invoices")
      .select(
        "id, invoice_number, type, created_at, total, customer_id, supplier_id, customer:customers(name), supplier:suppliers(name)"
      )
      .eq("type", sourceType)
      .eq("status", "completed")
      .ilike("invoice_number", `%${term}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      toastError(error.message);
      setInvoiceResults([]);
    } else {
      setInvoiceResults((data as SourceInvoiceRow[]) || []);
    }
    setInvoiceSearching(false);
  }

  async function buildCartFromOriginal(
    originalId: string,
    type: "sale_return" | "purchase_return",
    options?: {
      excludeReturnId?: string;
      /** When editing: seed quantities from this return's lines */
      seedFromReturnId?: string;
    }
  ): Promise<ReturnLineCart[]> {
    let priorQuery = supabase
      .from("invoices")
      .select("id, invoice_items(product_id, quantity, unit_price)")
      .eq("original_invoice_id", originalId)
      .eq("type", type)
      .eq("status", "completed");
    if (options?.excludeReturnId) {
      priorQuery = priorQuery.neq("id", options.excludeReturnId);
    }

    const [{ data: lines, error: linesError }, { data: priorReturns }, seedRes] =
      await Promise.all([
        supabase
          .from("invoice_items")
          .select("*, product:products(*)")
          .eq("invoice_id", originalId),
        priorQuery,
        options?.seedFromReturnId
          ? supabase
              .from("invoice_items")
              .select("product_id, quantity, unit_price, unit_cost")
              .eq("invoice_id", options.seedFromReturnId)
          : Promise.resolve({ data: null as null }),
      ]);

    if (linesError) throw linesError;
    if (!lines?.length) {
      throw new Error("الفاتورة لا تحتوي على بنود.");
    }

    const origAgg = new Map<
      string,
      { product: Product; unit_price: number; unit_cost: number | null; qty: number }
    >();
    for (const line of lines) {
      const product = line.product as Product | null;
      if (!product) continue;
      const unitPrice = Number(line.unit_price);
      const key = `${line.product_id}|${unitPrice.toFixed(4)}`;
      const prev = origAgg.get(key);
      if (prev) {
        prev.qty += Number(line.quantity);
      } else {
        origAgg.set(key, {
          product,
          unit_price: unitPrice,
          unit_cost: line.unit_cost != null ? Number(line.unit_cost) : null,
          qty: Number(line.quantity),
        });
      }
    }

    const returnedAgg = new Map<string, number>();
    for (const ret of priorReturns || []) {
      const items = (ret as {
        invoice_items?: { product_id: string; quantity: number; unit_price: number }[];
      }).invoice_items;
      for (const item of items || []) {
        const key = `${item.product_id}|${Number(item.unit_price).toFixed(4)}`;
        returnedAgg.set(key, (returnedAgg.get(key) || 0) + Number(item.quantity));
      }
    }

    const seedQty = new Map<string, number>();
    const seedCost = new Map<string, number | null>();
    for (const item of seedRes.data || []) {
      const key = `${item.product_id}|${Number(item.unit_price).toFixed(4)}`;
      seedQty.set(key, (seedQty.get(key) || 0) + Number(item.quantity));
      if (item.unit_cost != null) seedCost.set(key, Number(item.unit_cost));
    }

    const finalCart: ReturnLineCart[] = [];
    for (const [, row] of origAgg) {
      const key = `${row.product.id}|${row.unit_price.toFixed(4)}`;
      const remaining = Math.max(0, row.qty - (returnedAgg.get(key) || 0));
      if (remaining <= 0.001 && !seedQty.has(key)) continue;
      // New return: start all quantities at 0 — user fills what they want to return.
      // Edit: seed from the existing return lines (capped by remaining).
      const qty = options?.seedFromReturnId
        ? Math.min(seedQty.get(key) || 0, remaining)
        : 0;
      if (options?.seedFromReturnId && qty <= 0.001 && remaining <= 0.001) {
        continue;
      }
      if (!options?.seedFromReturnId && remaining <= 0.001) continue;
      finalCart.push({
        product: row.product,
        quantity: qty,
        unit_price: row.unit_price,
        unit_cost: seedCost.has(key) ? seedCost.get(key)! : row.unit_cost,
        max_quantity: remaining,
        total: qty * row.unit_price,
      });
    }

    if (finalCart.length === 0) {
      throw new Error("تم إرجاع كل أصناف هذه الفاتورة مسبقاً.");
    }
    return finalCart;
  }

  async function selectSourceInvoice(inv: SourceInvoiceRow) {
    setLoadingSource(true);
    setInvoiceSearch("");
    setInvoiceResults([]);

    try {
      const finalCart = await buildCartFromOriginal(inv.id, returnType);
      setSourceInvoice(inv);
      setCart(finalCart);
      setSelectedCustomerId(inv.customer_id || "");
      setSelectedSupplierId(inv.supplier_id || "");
    } catch (err: any) {
      toastError(err?.message || "تعذر تحميل الفاتورة");
    } finally {
      setLoadingSource(false);
    }
  }

  async function startEditReturn(inv: any) {
    if (!inv.original_invoice_id) {
      toastError("هذا المرتجع غير مربوط بفاتورة أصلية ولا يمكن تعديله.");
      return;
    }
    setLoadingSource(true);
    try {
      const type = inv.type as "sale_return" | "purchase_return";
      const { data: orig, error: origErr } = await supabase
        .from("invoices")
        .select(
          "id, invoice_number, type, created_at, total, customer_id, supplier_id, customer:customers(name), supplier:suppliers(name)"
        )
        .eq("id", inv.original_invoice_id)
        .single();
      if (origErr || !orig) throw new Error(origErr?.message || "الفاتورة الأصلية غير موجودة");

      const finalCart = await buildCartFromOriginal(inv.original_invoice_id, type, {
        excludeReturnId: inv.id,
        seedFromReturnId: inv.id,
      });

      setEditingReturn({
        id: inv.id,
        invoice_number: inv.invoice_number,
        type,
        customer_id: inv.customer_id,
        supplier_id: inv.supplier_id,
        total: Number(inv.total),
        paid_amount: Number(inv.paid_amount),
        safe_id: inv.safe_id,
        original_invoice_id: inv.original_invoice_id,
      });
      setReturnType(type);
      setSourceInvoice(orig as SourceInvoiceRow);
      setCart(finalCart);
      setSelectedCustomerId(inv.customer_id || orig.customer_id || "");
      setSelectedSupplierId(inv.supplier_id || orig.supplier_id || "");
      setPaymentMethod(inv.payment_method === "credit" ? "credit" : "cash");
      setSelectedSafeId(inv.safe_id || safes[0]?.id || "");
      setNotes(inv.notes || "");
      setShowForm(true);
    } catch (err: any) {
      toastError(err?.message || "تعذر فتح المرتجع للتعديل");
    } finally {
      setLoadingSource(false);
    }
  }

  async function handleDeleteReturn(inv: any) {
    if (!canDeleteInvoices) {
      toastError("ليس لديك صلاحية حذف الفواتير");
      return;
    }
    if (
      !(await confirm({
        message: `حذف المرتجع ${inv.invoice_number}؟\nسيتم عكس المخزون والخزنة/الرصيد. الفاتورة الأصلية لن تُمس.`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }

    try {
      setBusyDeleteId(inv.id);
      await deleteReturnInvoiceFully(supabase, {
        id: inv.id,
        invoice_number: inv.invoice_number,
        type: inv.type,
        customer_id: inv.customer_id,
        supplier_id: inv.supplier_id,
        total: Number(inv.total),
        paid_amount: Number(inv.paid_amount),
        safe_id: inv.safe_id,
        original_invoice_id: inv.original_invoice_id,
      });
      toastSuccess("تم حذف المرتجع وعكس المخزون والحسابات");
      await fetchReturns();
      await fetchLists();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر الحذف");
    } finally {
      setBusyDeleteId(null);
    }
  }

  async function printReturn(inv: any) {
    const [{ data: lines }, partyRes] = await Promise.all([
      supabase
        .from("invoice_items")
        .select("*, product:products(name, sku)")
        .eq("invoice_id", inv.id),
      inv.type === "sale_return" && inv.customer_id
        ? supabase.from("customers").select("name, phone").eq("id", inv.customer_id).single()
        : inv.supplier_id
          ? supabase.from("suppliers").select("name, phone").eq("id", inv.supplier_id).single()
          : Promise.resolve({ data: null as { name: string; phone?: string } | null }),
    ]);

    setDocPrint({
      invoice: inv,
      originalInvoiceNumber:
        inv.original_invoice?.invoice_number ||
        (typeof inv.original_invoice === "object"
          ? inv.original_invoice?.invoice_number
          : undefined),
      partyName:
        partyRes.data?.name || inv.customer?.name || inv.supplier?.name || undefined,
      partyPhone: partyRes.data?.phone,
      items:
        lines?.map((line) => ({
          name: line.product?.name || "صنف",
          sku: line.product?.sku || "",
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
          discount: Number(line.discount) || 0,
          total: Number(line.total),
        })) || [],
    });
  }

  function returnRowActions(inv: any): RowAction[] {
    return [
      {
        label: "طباعة",
        tone: "print",
        onClick: () => void printReturn(inv),
      },
      {
        label: "تعديل",
        tone: "edit",
        onClick: () => void startEditReturn(inv),
        disabled: busyDeleteId === inv.id || loadingSource,
      },
      ...(canDeleteInvoices
        ? [
            {
              label: "حذف",
              tone: "delete" as const,
              onClick: () => void handleDeleteReturn(inv),
              disabled: busyDeleteId === inv.id,
            },
          ]
        : []),
    ];
  }

  const filteredReturns = invoices.filter((inv) => {
    const nameMatch =
      inv.type === "sale_return" ? inv.customer?.name : inv.supplier?.name;
    const origNum = inv.original_invoice?.invoice_number;
    const matchesSearch = smartSearchMatch(searchTerm, [
      inv.invoice_number,
      nameMatch,
      origNum,
    ]);
    const matchesType = !filterType || inv.type === filterType;
    const day = inv.created_at.slice(0, 10);
    const matchesFrom = !dateFrom || day >= dateFrom;
    const matchesTo = !dateTo || day <= dateTo;
    return matchesSearch && matchesType && matchesFrom && matchesTo;
  });

  const { items: sortedReturns, sortConfig, requestSort } = useSort(filteredReturns);

  const totalSaleReturns = sortedReturns
    .filter((r) => r.type === "sale_return")
    .reduce((sum, r) => sum + r.total, 0);

  const totalPurchaseReturns = sortedReturns
    .filter((r) => r.type === "purchase_return")
    .reduce((sum, r) => sum + r.total, 0);

  const netReturnVal = totalSaleReturns - totalPurchaseReturns;

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.total, 0),
    [cart]
  );
  const returnPaidAmount = paymentMethod === "cash" ? cartTotal : 0;
  const selectedSafeName = safes.find((s) => s.id === selectedSafeId)?.name;
  const activeReturnLines = cart.filter((item) => item.quantity > 0.001);

  function updateReturnQty(index: number, quantity: number) {
    setCart(
      cart.map((item, i) => {
        if (i !== index) return item;
        const qty = Math.min(Math.max(0, quantity), item.max_quantity);
        return {
          ...item,
          quantity: qty,
          total: qty * item.unit_price,
        };
      })
    );
  }

  function removeFromCart(index: number) {
    setCart(cart.filter((_, i) => i !== index));
  }

  async function handleSaveReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceInvoice) {
      toastError("الرجاء اختيار الفاتورة الأصلية أولاً.");
      return;
    }
    if (activeReturnLines.length === 0) {
      toastError("الرجاء تحديد كمية إرجاع لصنف واحد على الأقل.");
      return;
    }

    if (returnType === "sale_return" && paymentMethod === "credit" && !selectedCustomerId) {
      toastError("الرجاء تحديد العميل للمرتجعات الآجلة.");
      return;
    }

    if (returnType === "purchase_return" && paymentMethod === "credit" && !selectedSupplierId) {
      toastError("الرجاء تحديد المورد للمرتجعات الآجلة.");
      return;
    }

    if (paymentMethod === "cash" && !selectedSafeId) {
      toastError("الرجاء تحديد الخزنة للمدفوعات النقدية.");
      return;
    }

    setFormSaving(true);

    const targetCustomerId = returnType === "sale_return" ? selectedCustomerId || null : null;
    const targetSupplierId = returnType === "purchase_return" ? selectedSupplierId || null : null;
    const total = activeReturnLines.reduce((s, i) => s + i.total, 0);
    const paidAmount = paymentMethod === "cash" ? total : 0;

    try {
      if (editingReturn) {
        await updateReturnInvoiceFully(supabase, editingReturn, {
          items: activeReturnLines.map((item) => ({
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            unit_cost: item.unit_cost,
            total: item.total,
          })),
          total,
          paidAmount,
          paymentMethod,
          safeId: paymentMethod === "cash" ? selectedSafeId : null,
          notes: notes || null,
          customerId: targetCustomerId,
          supplierId: targetSupplierId,
        });
        toastSuccess("تم تحديث المرتجع وعكس/تطبيق المخزون والحسابات.");
      } else {
        const invoiceItems = mapCartToInvoiceItems(
          "pending",
          activeReturnLines.map((item) => ({
            product: item.product,
            quantity: item.quantity,
            unit_price: item.unit_price,
            unit_cost: item.unit_cost,
            total: item.total,
          })),
          { kind: returnType }
        );
        await createInvoiceOnlineOrQueue(supabase, {
          type: returnType,
          items: invoiceItems,
          subtotal: total,
          total,
          paidAmount,
          paymentMethod,
          customerId: targetCustomerId,
          supplierId: targetSupplierId,
          safeId: paymentMethod === "cash" ? selectedSafeId : null,
          notes: notes || null,
          originalInvoiceId: sourceInvoice.id,
          createdAt: new Date().toISOString(),
        });
        toastSuccess("تم حفظ المرتجع بنجاح (قيد جديد) مع ربط الفاتورة الأصلية.");
      }

      setShowForm(false);
      resetForm();
      fetchReturns();
      fetchLists();
    } catch (err: any) {
      toastError("حدث خطأ أثناء حفظ المرتجع: " + err.message);
    } finally {
      setFormSaving(false);
    }
  }

  function resetForm() {
    setCart([]);
    setSourceInvoice(null);
    setInvoiceSearch("");
    setInvoiceResults([]);
    setSelectedCustomerId("");
    setSelectedSupplierId("");
    setPaymentMethod("cash");
    setSelectedSafeId(safes[0]?.id || "");
    setNotes("");
    setEditingReturn(null);
  }

  const partyDisplayName =
    returnType === "sale_return"
      ? customers.find((c) => c.id === selectedCustomerId)?.name ||
        sourceInvoice?.customer?.name ||
        "عميل نقدي"
      : suppliers.find((s) => s.id === selectedSupplierId)?.name ||
        sourceInvoice?.supplier?.name ||
        "مورد نقدي";

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {!embedded && <h1 className="text-2xl font-bold text-gray-900">إدارة المرتجعات</h1>}
        {embedded && <h2 className="text-lg font-bold text-[#172033]">مرتجعات المبيعات</h2>}
        <div className="flex flex-wrap gap-2 sm:mr-auto">
          <PrintListButton
            onClick={() => setShowListPrint(true)}
            rowCount={sortedReturns.length}
            label="طباعة القائمة"
          />
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            مرتجع جديد
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="text"
          placeholder="بحث برقم المرتجع أو الفاتورة الأصلية أو الاسم..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 max-w-md rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
        <DateField
          value={dateFrom}
          onChange={setDateFrom}
          className="w-auto min-w-[160px]"
          inputClassName="border-gray-300"
        />
        <DateField
          value={dateTo}
          onChange={setDateTo}
          className="w-auto min-w-[160px]"
          inputClassName="border-gray-300"
        />
        <TodayDateChip
          dateFrom={dateFrom}
          dateTo={dateTo}
          onApply={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">كل أنواع المرتجعات</option>
          <option value="sale_return">مرتجع مبيعات (عميل)</option>
          <option value="purchase_return">مرتجع مشتريات (مورد)</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex h-full items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] bg-gray-50/95 backdrop-blur-xs">
                <tr>
                  <SortableHeader
                    label="رقم المرتجع"
                    field="invoice_number"
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <th className="px-4 py-3 text-right font-medium text-gray-700">
                    الفاتورة الأصلية
                  </th>
                  <SortableHeader
                    label="النوع"
                    field="type"
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <SortableHeader
                    label="الطرف الثاني"
                    field="customer.name"
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <SortableHeader
                    label="التاريخ"
                    field="created_at"
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <SortableHeader
                    label="المبلغ الإجمالي"
                    field="total"
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <th className="px-4 py-3 text-right font-medium text-gray-700">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedReturns.map((inv) => (
                  <tr
                    key={inv.id}
                    className="hover:bg-gray-50"
                    onContextMenu={(e) =>
                      openMenu(e, toContextMenuItems(returnRowActions(inv)))
                    }
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold">
                      {inv.invoice_number}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-blue-800">
                      {inv.original_invoice?.invoice_number || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          inv.type === "sale_return"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-purple-100 text-purple-800"
                        }`}
                      >
                        {inv.type === "sale_return" ? "مرتجع مبيعات" : "مرتجع مشتريات"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {inv.type === "sale_return"
                        ? inv.customer?.name || "عميل نقدي"
                        : inv.supplier?.name || "مورد نقدي"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDateRelative(inv.created_at)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {formatCurrency(inv.total)}
                    </td>
                    <td className="px-4 py-3">
                      <TableRowActions actions={returnRowActions(inv)} />
                    </td>
                  </tr>
                ))}
                {sortedReturns.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      لا توجد فواتير مرتجعة
                    </td>
                  </tr>
                )}
              </tbody>
              {sortedReturns.length > 0 && (
                <tfoot className="sticky bottom-0 bg-gray-50 font-bold border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-10">
                  <tr className="bg-gray-50/95 backdrop-blur-xs text-gray-900">
                    <td className="px-4 py-3 font-semibold text-gray-700" colSpan={2}>
                      إجمالي المعروض ({sortedReturns.length})
                    </td>
                    <td colSpan={3}>
                      <div className="flex flex-col gap-0.5 text-xs text-gray-600">
                        <span>
                          إجمالي مرتجع مبيعات (خارج): {formatCurrency(totalSaleReturns)}
                        </span>
                        <span>
                          إجمالي مرتجع مشتريات (داخل): {formatCurrency(totalPurchaseReturns)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-bold text-blue-700">
                      <div>
                        <span className="text-[10px] text-gray-500 block font-normal">
                          صافي حركة المرتجع
                        </span>
                        {formatCurrency(Math.abs(netReturnVal))}{" "}
                        {netReturnVal >= 0 ? "(صرف)" : "(قبض)"}
                      </div>
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {showListPrint && (
        <PrintReportPreview
          title="تقرير المرتجعات"
          rows={sortedReturns}
          columns={returnInvoiceColumns}
          settings={settings}
          summary={[
            { label: "العدد", value: String(sortedReturns.length) },
            { label: "مرتجع مبيعات", value: formatCurrency(totalSaleReturns) },
            {
              label: "مرتجع مشتريات",
              value: formatCurrency(totalPurchaseReturns),
            },
          ]}
          onClose={() => setShowListPrint(false)}
        />
      )}

      {docPrint && (
        <DocumentPrintPreview
          kind={
            docPrint.invoice.type === "purchase_return"
              ? "purchase_return"
              : "sale_return"
          }
          documentNumber={docPrint.invoice.invoice_number}
          originalDocumentNumber={docPrint.originalInvoiceNumber}
          items={docPrint.items}
          partyName={docPrint.partyName}
          partyPhone={docPrint.partyPhone}
          subtotal={
            Number(docPrint.invoice.subtotal) ||
            docPrint.items.reduce((s, i) => s + i.total, 0)
          }
          discount={Number(docPrint.invoice.discount_amount) || 0}
          taxAmount={Number(docPrint.invoice.tax_amount) || 0}
          total={Number(docPrint.invoice.total)}
          paid={Number(docPrint.invoice.paid_amount) || 0}
          paymentMethod={docPrint.invoice.payment_method}
          notes={docPrint.invoice.notes}
          cashierName={profile?.full_name || "الكاشير"}
          settings={settings}
          issuedAt={docPrint.invoice.created_at}
          onClose={() => setDocPrint(null)}
        />
      )}

      {showForm && (
        <Modal
          open
          onClose={() => {
            setShowForm(false);
            resetForm();
          }}
          title={
            editingReturn
              ? `تعديل مرتجع ${editingReturn.invoice_number}`
              : "تسجيل فاتورة مرتجع جديدة"
          }
          wide
        >
          <form onSubmit={handleSaveReturn} className="space-y-4" dir="rtl">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">
                  نوع المرتجع
                </label>
                <select
                  value={returnType}
                  disabled={!!editingReturn}
                  onChange={(e) => {
                    setReturnType(e.target.value as "sale_return" | "purchase_return");
                    setCart([]);
                    setSourceInvoice(null);
                    setInvoiceSearch("");
                    setInvoiceResults([]);
                    setSelectedCustomerId("");
                    setSelectedSupplierId("");
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
                >
                  <option value="sale_return">مرتجع مبيعات (من عميل)</option>
                  <option value="purchase_return">مرتجع مشتريات (إلى مورد)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">
                  طريقة الدفع للمرتجع
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as "cash" | "credit")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="cash">نقدي (رد/استلام أموال فوراً)</option>
                  <option value="credit">آجل (تعديل رصيد الحساب)</option>
                </select>
              </div>

              {paymentMethod === "cash" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    الخزنة المتأثرة
                  </label>
                  <select
                    value={selectedSafeId}
                    onChange={(e) => setSelectedSafeId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    required
                  >
                    <option value="">اختر الخزنة</option>
                    {safes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({formatCurrency(s.balance)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {sourceInvoice && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    {returnType === "sale_return" ? "العميل" : "المورد"}
                  </label>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
                    {partyDisplayName}
                  </div>
                </div>
              )}
            </div>

            <div className="relative border border-blue-100 rounded-xl bg-blue-50/40 p-4">
              <label className="mb-1 block text-xs font-semibold text-gray-700">
                {returnType === "sale_return"
                  ? "اختر فاتورة البيع الأصلية"
                  : "اختر فاتورة الشراء الأصلية"}
              </label>
              {sourceInvoice ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2">
                  <div className="text-sm">
                    <span className="font-mono font-bold text-blue-900">
                      {sourceInvoice.invoice_number}
                    </span>
                    <span className="mx-2 text-gray-400">·</span>
                    <span className="text-gray-700">
                      {sourceInvoice.customer?.name ||
                        sourceInvoice.supplier?.name ||
                        "—"}
                    </span>
                    <span className="mx-2 text-gray-400">·</span>
                    <span className="font-semibold">
                      {formatCurrency(sourceInvoice.total)}
                    </span>
                  </div>
                  {!editingReturn && (
                    <button
                      type="button"
                      onClick={() => {
                        setSourceInvoice(null);
                        setCart([]);
                        setSelectedCustomerId("");
                        setSelectedSupplierId("");
                      }}
                      className="text-xs font-semibold text-red-600 hover:underline"
                    >
                      تغيير الفاتورة
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      placeholder="ابحث برقم الفاتورة..."
                      value={invoiceSearch}
                      onChange={(e) => setInvoiceSearch(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 pr-10 pl-4 py-2 text-sm focus:border-blue-500 focus:outline-none bg-white"
                    />
                    <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
                  </div>
                  {(invoiceSearching || invoiceResults.length > 0 || invoiceSearch.trim()) && (
                    <div className="absolute right-4 left-4 z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                      {invoiceSearching && (
                        <div className="p-3 text-center text-xs text-gray-500">جاري البحث...</div>
                      )}
                      {!invoiceSearching &&
                        invoiceResults.map((inv) => (
                          <button
                            key={inv.id}
                            type="button"
                            disabled={loadingSource}
                            onClick={() => void selectSourceInvoice(inv)}
                            className="w-full px-4 py-2.5 text-right text-sm hover:bg-blue-50 border-b border-gray-100 flex items-center justify-between gap-2"
                          >
                            <span className="font-mono font-semibold text-gray-900">
                              {inv.invoice_number}
                            </span>
                            <span className="text-xs text-gray-500">
                              {inv.customer?.name || inv.supplier?.name || "—"} ·{" "}
                              {formatCurrency(inv.total)} ·{" "}
                              {formatDateRelative(inv.created_at)}
                            </span>
                          </button>
                        ))}
                      {!invoiceSearching &&
                        invoiceSearch.trim() &&
                        invoiceResults.length === 0 && (
                          <div className="p-3 text-center text-xs text-gray-500">
                            لا توجد فواتير مطابقة
                          </div>
                        )}
                    </div>
                  )}
                </>
              )}
              {loadingSource && (
                <p className="mt-2 text-xs text-blue-700">جاري تحميل بنود الفاتورة...</p>
              )}
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-2 text-right">الصنف</th>
                    <th className="px-4 py-2 text-right w-28">كمية الإرجاع</th>
                    <th className="px-4 py-2 text-right w-24">المتبقي</th>
                    <th className="px-4 py-2 text-right w-32">سعر الفاتورة</th>
                    <th className="px-4 py-2 text-right w-32">الإجمالي</th>
                    <th className="px-4 py-2 text-center w-16">إزالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {cart.map((item, index) => (
                    <tr key={`${item.product.id}-${item.unit_price}`}>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-gray-900">{item.product.name}</p>
                        <span className="text-xs text-gray-500 font-mono">
                          {item.product.sku}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="number"
                          min="0"
                          max={item.max_quantity}
                          step="any"
                          value={item.quantity === 0 ? "" : item.quantity}
                          onChange={(e) => {
                            const n = parseNumberInput(e.target.value);
                            updateReturnQty(index, n === null ? 0 : n);
                          }}
                          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">
                        {item.max_quantity}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-sm text-gray-800">
                        {formatCurrency(item.unit_price)}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-gray-800">
                        {formatCurrency(item.total)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeFromCart(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4 mx-auto" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {cart.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                        اختر فاتورة أصلية أولاً لتحميل الأصناف بأسعارها المسجّلة.
                      </td>
                    </tr>
                  )}
                  {cart.length > 0 && activeReturnLines.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 text-center text-xs text-amber-700 bg-amber-50">
                        الكميات تبدأ من صفر — حدد كمية الإرجاع لكل صنف تريد إرجاعه.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">
                  بيان / ملاحظات المرتجع
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="أدخل سبب الإرجاع أو ملاحظات أخرى..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="border border-gray-200 rounded-xl bg-gray-50/50 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>إجمالي المرتجع:</span>
                  <span className="font-semibold text-gray-900">
                    {formatCurrency(cartTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-base font-bold text-blue-700">
                  <span>المبلغ المستحق:</span>
                  <span>{formatCurrency(cartTotal)}</span>
                </div>
                {paymentMethod === "cash" && (
                  <div className="text-[10px] text-gray-500 text-left border-t border-gray-100 pt-1">
                    {returnType === "sale_return"
                      ? "* سيتم خصم هذا المبلغ من الخزنة المحددة فوراً لتسليمه للعميل."
                      : "* سيتم إيداع هذا المبلغ في الخزنة المحددة فوراً عند استلامه من المورد."}
                  </div>
                )}
                {paymentMethod === "credit" && (
                  <div className="text-[10px] text-gray-500 text-left border-t border-gray-100 pt-1">
                    {returnType === "sale_return"
                      ? "* سيتم إنقاص مديونية العميل بقيمة المرتجع."
                      : "* سيتم إنقاص رصيد المورد المستحق بقيمة المرتجع."}
                  </div>
                )}
              </div>
            </div>

            {activeReturnLines.length > 0 && (
              <p className="rounded-lg bg-blue-50 px-3 py-2 text-center text-xs text-blue-900">
                قيد جديد · مرتبط بـ {sourceInvoice?.invoice_number} · الإجمالي:{" "}
                {formatCurrency(cartTotal)} · المدفوع: {formatCurrency(returnPaidAmount)}
                {paymentMethod === "cash" && selectedSafeName
                  ? ` · الخزنة: ${selectedSafeName}`
                  : paymentMethod === "credit"
                    ? " · آجل"
                    : ""}
              </p>
            )}
            <div className="flex gap-3 pt-4 border-t border-gray-100">
              <button
                type="submit"
                disabled={formSaving || !sourceInvoice || activeReturnLines.length === 0}
                className="flex-1 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {formSaving
                  ? "جاري حفظ المرتجع..."
                  : editingReturn
                    ? "حفظ التعديلات"
                    : "حفظ وإجراء المرتجع"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                إلغاء
              </button>
            </div>
          </form>
        </Modal>
      )}
      {contextMenu}
    </div>
  );
}
