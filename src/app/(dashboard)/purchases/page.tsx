"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import {
  formatCurrency,
  formatDateRelative,
  smartSearchMatch,
  parseNumberInput,
  roundMoney,
} from "@/lib/utils";
import {
  adjustProductStock,
  replaceStockImpact,
  updateProductsBuyPrice,
} from "@/lib/inventory";
import { adjustSupplierBalance } from "@/lib/party-balance";
import {
  mapCartToInvoiceItems,
  insertInvoiceItems,
  purchaseNetUnitCosts,
} from "@/lib/invoice-cost";
import { safesOrderQuery } from "@/lib/safes-order";
import {
  pickDefaultSafeId,
  syncInvoiceSafePayment,
  withInvoiceSafeId,
} from "@/lib/safe-transactions";
import { formatRpcError } from "@/lib/rpc-error";
import { deletePurchaseInvoiceFully } from "@/lib/invoice-delete";
import { useSort } from "@/hooks/useSort";
import { useUrlSearchTerm } from "@/hooks/useUrlSearchTerm";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SortableHeader } from "@/components/ui/SortableHeader";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { TableRowActions, type RowAction } from "@/components/ui/TableRowActions";
import {
  useRowContextMenu,
  toContextMenuItems,
  type ContextMenuItem,
} from "@/components/ui/ContextMenu";
import { copyAsLabel, posCopyUrl } from "@/lib/pos-copy";
import { Modal } from "@/components/ui/Modal";
import { DateField } from "@/components/ui/DateField";
import { TodayDateChip } from "@/components/ui/TodayDateChip";
import { PrintReportPreview } from "@/components/print/PrintReportPreview";
import { DocumentPrintPreview } from "@/components/print/DocumentPrintPreview";
import { PrintListButton } from "@/components/print/PrintListButton";
import { purchaseInvoiceColumns } from "@/components/print/report-columns";
import type { Product, Safe, Settings, Supplier } from "@/types";
import { ClipboardList, Plus } from "lucide-react";
import {
  createInvoiceOnlineOrQueue,
  getSnapshot,
  isBrowserOnline,
  listOutbox,
  readLocalThenNetwork,
  withTimeout,
  type OutboxInvoicePayload,
} from "@/lib/offline";

type PurchasesSection = "invoices" | "orders";

type LineItem = {
  product: Product;
  quantity: number;
  unit_price: number;
  total: number;
  unit_cost?: number | null;
};

type PurchaseInvoice = {
  id: string;
  invoice_number: string;
  supplier_id?: string;
  supplier?: { name: string };
  total: number;
  paid_amount: number;
  payment_method: string;
  safe_id?: string;
  subtotal?: number;
  tax_amount?: number;
  discount_amount?: number;
  notes?: string;
  created_at: string;
  status: string;
};

type DocPrintState = {
  invoice: PurchaseInvoice;
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
};

const emptyForm = {
  supplier_id: "",
  payment_method: "cash",
  paid_amount: "",
  safe_id: "",
  notes: "",
  created_at: "",
};

function purchasePaymentBadge(inv: PurchaseInvoice): {
  label: string;
  className: string;
} {
  const total = Number(inv.total);
  const paid = Number(inv.paid_amount);
  const hasRemaining = paid + 0.001 < total;

  if (inv.payment_method === "credit" || hasRemaining) {
    const partial = inv.payment_method === "cash" && paid > 0 && hasRemaining;
    return {
      label: partial ? "آجل جزئي" : "آجل",
      className: partial
        ? "bg-orange-50 text-orange-700"
        : "bg-amber-50 text-amber-800",
    };
  }
  return { label: "نقدي", className: "bg-emerald-50 text-emerald-700" };
}

export default function PurchasesPage() {
  const router = useRouter();
  const supabase = createClient();
  const { canDeleteInvoices, profile } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const [section, setSection] = useState<PurchasesSection>("invoices");
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [safes, setSafes] = useState<Safe[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useUrlSearchTerm();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [mode, setMode] = useState<"create" | "edit" | "view" | null>(null);
  const [activeInvoice, setActiveInvoice] = useState<PurchaseInvoice | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [items, setItems] = useState<LineItem[]>([]);
  const [priceBasis, setPriceBasis] = useState<"buy" | "sell">("buy");
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<"amount" | "percent">(
    "amount"
  );
  const [productSearch, setProductSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showListPrint, setShowListPrint] = useState(false);
  const [docPrint, setDocPrint] = useState<DocPrintState | null>(null);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const { openMenu, menu: contextMenu } = useRowContextMenu();

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "orders" || tab === "invoices") setSection(tab);
  }, []);

  function switchSection(next: PurchasesSection) {
    setSection(next);
    const url = new URL(window.location.href);
    if (next === "invoices") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState({}, "", url.pathname + url.search);
  }

  async function fetchAll() {
    setLoading(true);
    const offline = !isBrowserOnline();

    await readLocalThenNetwork<{
      invoices: PurchaseInvoice[];
      suppliers: Supplier[];
      products: Product[];
      settings: Settings | null;
      safes: Safe[];
    }>({
      offline,
      timeoutMs: 4000,
      local: async () => {
        const [snap, pending] = await Promise.all([
          getSnapshot(),
          listOutbox({ includeSynced: false }),
        ]);
        if (!snap) return null;

        const fromSnap: PurchaseInvoice[] = (snap.recentInvoices || [])
          .filter((inv) => inv.type === "purchase")
          .map((inv) => ({
            id: inv.id,
            invoice_number: inv.invoice_number,
            supplier_id: inv.supplier_id || undefined,
            supplier: inv.supplier_name
              ? { name: inv.supplier_name }
              : undefined,
            total: inv.total,
            paid_amount: inv.paid_amount,
            payment_method: inv.payment_method || "cash",
            created_at: inv.created_at,
            status: inv.status || "completed",
          }));

        const fromOutbox: PurchaseInvoice[] = [];
        for (const e of pending) {
          if (e.type !== "invoice") continue;
          const payload = e.payload as OutboxInvoicePayload;
          if (payload.type !== "purchase") continue;
          fromOutbox.push({
            id: e.id,
            invoice_number: payload.tempNumber,
            supplier_id: payload.supplierId || undefined,
            supplier: payload.label ? { name: payload.label } : undefined,
            total: payload.total,
            paid_amount: payload.paidAmount,
            payment_method: payload.paymentMethod,
            created_at: e.occurred_at,
            status: "pending_sync",
          });
        }

        const byId = new Map<string, PurchaseInvoice>();
        for (const inv of [...fromOutbox, ...fromSnap]) byId.set(inv.id, inv);
        let invoices = Array.from(byId.values()).sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        if (dateFrom) {
          const fromTs = new Date(`${dateFrom}T00:00:00`).getTime();
          invoices = invoices.filter(
            (inv) => new Date(inv.created_at).getTime() >= fromTs
          );
        }
        if (dateTo) {
          const toTs = new Date(`${dateTo}T23:59:59`).getTime();
          invoices = invoices.filter(
            (inv) => new Date(inv.created_at).getTime() <= toTs
          );
        }

        return {
          invoices,
          suppliers: (snap.suppliers || [])
            .filter((s) => s.is_active !== false)
            .map(
              (s) =>
                ({
                  id: s.id,
                  name: s.name,
                  phone: s.phone || undefined,
                  balance: s.balance,
                  created_at: "",
                }) as Supplier
            ),
          products: (snap.products || [])
            .filter((p) => p.is_active !== false)
            .map(
              (p) => ({ ...p, category: null }) as unknown as Product
            ),
          settings: (snap.settings as Settings | null) ?? null,
          safes: (snap.safes || []).filter((s) => s.is_active) as Safe[],
        };
      },
      network: async () => {
        let query = supabase
          .from("invoices")
          .select("*, supplier:suppliers(name, phone)")
          .eq("type", "purchase")
          .order("created_at", { ascending: false });

        if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
        if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);

        const [invRes, supRes, prodRes, settingsRes, safesRes] =
          await withTimeout(
            Promise.all([
              query,
              supabase
                .from("suppliers")
                .select("*")
                .eq("is_active", true)
                .order("name"),
              supabase
                .from("products")
                .select("*")
                .eq("is_active", true)
                .order("name"),
              supabase.from("settings").select("*").limit(1).maybeSingle(),
              safesOrderQuery(
                supabase.from("safes").select("*").eq("is_active", true)
              ),
            ]),
            4000
          );
        if (invRes.error) throw invRes.error;
        return {
          invoices: (invRes.data as PurchaseInvoice[]) || [],
          suppliers: (supRes.data as Supplier[]) || [],
          products: (prodRes.data as Product[]) || [],
          settings: (settingsRes.data as Settings | null) ?? null,
          safes: (safesRes.data as Safe[]) || [],
        };
      },
      apply: (data) => {
        setInvoices(data.invoices);
        setSuppliers(data.suppliers);
        setProducts(data.products);
        if (data.settings) setSettings(data.settings);
        setSafes(data.safes);
      },
    });

    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  const filtered = invoices.filter((inv) =>
    smartSearchMatch(searchTerm, [inv.invoice_number, inv.supplier?.name])
  );
  const { items: sorted, sortConfig, requestSort } = useSort(filtered);
  const totalPurchases = sorted.reduce((sum, inv) => sum + Number(inv.total), 0);
  const calculatedTotal = useMemo(
    () =>
      roundMoney(
        items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
      ),
    [items]
  );
  const discountAmount = roundMoney(
    discountType === "percent"
      ? (calculatedTotal * discount) / 100
      : Math.min(discount, calculatedTotal)
  );
  const grandTotal = roundMoney(Math.max(0, calculatedTotal - discountAmount));

  async function copyInvoiceNumber(invoiceNumber: string) {
    try {
      await navigator.clipboard.writeText(invoiceNumber);
      toastSuccess(`تم نسخ ${invoiceNumber}`);
    } catch {
      toastError("تعذر نسخ رقم الفاتورة");
    }
  }

  function purchaseRowActions(inv: PurchaseInvoice): RowAction[] {
    return [
      {
        label: "طباعة",
        tone: "print",
        icon: "printer",
        onClick: () => void printInvoice(inv),
      },
      {
        label: "نسخ الرقم",
        tone: "copy",
        icon: "copy",
        onClick: () => void copyInvoiceNumber(inv.invoice_number),
      },
      {
        label: "عرض",
        tone: "view",
        icon: "eye",
        onClick: () => void openInvoice(inv, "view"),
      },
      {
        label: "تعديل",
        tone: "edit",
        icon: "pencil",
        onClick: () => router.push(`/pos?mode=purchase&edit=${inv.id}`),
      },
      ...(canDeleteInvoices
        ? [
            {
              label: busyDeleteId === inv.id ? "جاري الحذف..." : "حذف",
              tone: "delete" as const,
              icon: "trash" as const,
              disabled: busyDeleteId === inv.id,
              onClick: () => void handleDelete(inv),
            },
          ]
        : []),
    ];
  }

  function purchaseContextItems(inv: PurchaseInvoice): ContextMenuItem[] {
    return [
      ...toContextMenuItems(purchaseRowActions(inv)),
      { kind: "separator" },
      {
        label: copyAsLabel("sale"),
        tone: "copy",
        icon: "copy",
        onClick: () => router.push(posCopyUrl(inv.id, "sale")),
      },
      {
        label: copyAsLabel("purchase"),
        tone: "copy",
        icon: "copy",
        onClick: () => router.push(posCopyUrl(inv.id, "purchase")),
      },
      {
        label: copyAsLabel("purchase_order"),
        tone: "copy",
        icon: "copy",
        onClick: () => router.push(posCopyUrl(inv.id, "purchase_order")),
      },
    ];
  }

  async function printInvoice(inv: PurchaseInvoice) {
    const [{ data: lines }, supplierRes] = await Promise.all([
      supabase
        .from("invoice_items")
        .select("*, product:products(name, sku)")
        .eq("invoice_id", inv.id),
      inv.supplier_id
        ? supabase
            .from("suppliers")
            .select("name, phone")
            .eq("id", inv.supplier_id)
            .single()
        : Promise.resolve({ data: null as { name: string; phone?: string } | null }),
    ]);

    setDocPrint({
      invoice: inv,
      partyName: supplierRes.data?.name || inv.supplier?.name,
      partyPhone: supplierRes.data?.phone,
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

  function openCreate() {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const local = new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
    setActiveInvoice(null);
    setForm({
      ...emptyForm,
      created_at: local,
      paid_amount: "",
      safe_id: pickDefaultSafeId(safes, "cash"),
    });
    setItems([]);
    setPriceBasis("buy");
    setDiscount(0);
    setDiscountType("amount");
    setMode("create");
  }

  async function openInvoice(inv: PurchaseInvoice, nextMode: "view" | "edit") {
    const { data: lines } = await supabase
      .from("invoice_items")
      .select("*, product:products(*)")
      .eq("invoice_id", inv.id);

    const date = new Date(inv.created_at);
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);

    setActiveInvoice(inv);
    let linkedSafeId = inv.safe_id || null;
    if (!linkedSafeId && Number(inv.paid_amount) > 0) {
      const { data: linked } = await supabase
        .from("safe_transactions")
        .select("safe_id")
        .eq("reference_id", inv.id)
        .eq("reference_type", "invoice")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      linkedSafeId = linked?.safe_id || null;
      if (linkedSafeId) {
        setActiveInvoice({ ...inv, safe_id: linkedSafeId });
      }
    }
    setForm({
      supplier_id: inv.supplier_id || "",
      payment_method: inv.payment_method || "cash",
      paid_amount: String(inv.paid_amount ?? 0),
      safe_id: pickDefaultSafeId(safes, inv.payment_method, linkedSafeId),
      notes: inv.notes || "",
      created_at: local,
    });
    setItems(
      lines?.map((line) => ({
        product: line.product,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
        total: Number(line.total),
        unit_cost: line.unit_cost != null ? Number(line.unit_cost) : null,
      })) || []
    );
    setPriceBasis("buy");
    setDiscountType("amount");
    setDiscount(Number(inv.discount_amount) || 0);
    setMode(nextMode);
  }

  function basisPrice(product: Product) {
    return priceBasis === "sell" ? product.sell_price : product.buy_price;
  }

  function changeBasis(next: "buy" | "sell") {
    if (next === priceBasis) return;
    setPriceBasis(next);
    if (items.length === 0) return;
    setItems((prev) =>
      prev.map((item) => {
        const price =
          next === "sell" ? item.product.sell_price : item.product.buy_price;
        return {
          ...item,
          unit_price: price,
          total: roundMoney(item.quantity * price),
        };
      })
    );
  }

  function addProduct(product: Product) {
    const existing = items.findIndex((item) => item.product.id === product.id);
    if (existing !== -1) {
      setItems(
        items.map((item, i) =>
          i === existing
            ? {
                ...item,
                quantity: item.quantity + 1,
                total: roundMoney((item.quantity + 1) * item.unit_price),
              }
            : item
        )
      );
    } else {
      const price = basisPrice(product);
      setItems([
        ...items,
        {
          product,
          quantity: 1,
          unit_price: price,
          total: roundMoney(price),
        },
      ]);
    }
    setProductSearch("");
  }

  function updateLine(index: number, quantity: number, unit_price: number) {
    setItems(
      items.map((item, i) =>
        i === index
          ? {
              ...item,
              quantity,
              unit_price,
              total: roundMoney(quantity * unit_price),
            }
          : item
      )
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (items.length === 0) {
      toastError("أضف صنفاً واحداً على الأقل.");
      return;
    }
    if (!form.supplier_id) {
      toastError("اختر المورد.");
      return;
    }

    const paid = Number(form.paid_amount) || 0;
    const remaining = grandTotal - paid;
    const needsSafe = paid > 0;
    const costLines = items.map((item) => ({
      product: item.product,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total: roundMoney(item.quantity * item.unit_price),
    }));

    if (needsSafe && !form.safe_id) {
      toastError("الرجاء تحديد الخزنة للمدفوعات.");
      return;
    }

    if (needsSafe && form.safe_id) {
      const safe = safes.find((s) => s.id === form.safe_id);
      const bal = Number(safe?.balance) || 0;
      if (paid > bal + 0.001) {
        toastError(
          `رصيد الخزنة غير كافٍ (المتاح ${bal.toFixed(2)} — المطلوب ${paid.toFixed(2)}). أودع في الخزنة أو اختر الدفع الآجل.`
        );
        return;
      }
    }

    setSaving(true);

    try {
      if (mode === "create") {
        const mapped = mapCartToInvoiceItems("pending", costLines, {
          kind: "purchase",
          invoiceDiscountAmount: discountAmount,
        });
        await createInvoiceOnlineOrQueue(supabase, {
          type: "purchase",
          items: mapped,
          subtotal: calculatedTotal,
          discountAmount,
          total: grandTotal,
          paidAmount: paid,
          paymentMethod:
            form.payment_method === "credit" ? "credit" : "cash",
          supplierId: form.supplier_id,
          safeId: needsSafe ? form.safe_id : null,
          notes: form.notes || null,
          createdAt: new Date(form.created_at).toISOString(),
        });

        await updateProductsBuyPrice(
          supabase,
          purchaseNetUnitCosts(costLines, discountAmount)
        );
      } else if (mode === "edit" && activeInvoice) {
        const { data: oldLines } = await supabase
          .from("invoice_items")
          .select("product_id, quantity")
          .eq("invoice_id", activeInvoice.id);

        const { error } = await supabase
          .from("invoices")
          .update(
            await withInvoiceSafeId(
              supabase,
              {
                supplier_id: form.supplier_id,
                created_at: new Date(form.created_at).toISOString(),
                payment_method: form.payment_method,
                subtotal: calculatedTotal,
                discount_amount: discountAmount,
                total: grandTotal,
                paid_amount: paid,
                notes: form.notes || null,
              },
              needsSafe ? form.safe_id : null
            )
          )
          .eq("id", activeInvoice.id);

        if (error) throw new Error(error.message);

        await supabase.from("invoice_items").delete().eq("invoice_id", activeInvoice.id);
        const editItemsErr = await insertInvoiceItems(
          supabase,
          mapCartToInvoiceItems(activeInvoice.id, costLines, {
            kind: "purchase",
            invoiceDiscountAmount: discountAmount,
          })
        );
        if (editItemsErr.error) throw new Error(editItemsErr.error.message);

        await updateProductsBuyPrice(
          supabase,
          purchaseNetUnitCosts(costLines, discountAmount)
        );

        await replaceStockImpact(
          supabase,
          (oldLines || []).map((l) => ({
            product_id: l.product_id,
            quantity: Number(l.quantity),
          })),
          items.map((item) => ({ product_id: item.product.id, quantity: item.quantity })),
          1
        );

        const oldRemaining =
          Math.max(
            0,
            Number(activeInvoice.total) - Number(activeInvoice.paid_amount)
          ) || 0;
        if (oldRemaining > 0 && activeInvoice.supplier_id) {
          await adjustSupplierBalance(
            supabase,
            activeInvoice.supplier_id,
            -oldRemaining
          );
        }
        if (remaining > 0 && form.supplier_id) {
          await adjustSupplierBalance(supabase, form.supplier_id, remaining);
        }

        await syncInvoiceSafePayment(supabase, {
          invoiceId: activeInvoice.id,
          invoiceNumber: activeInvoice.invoice_number,
          invoiceType: "purchase",
          oldPaidAmount: Number(activeInvoice.paid_amount) || 0,
          oldSafeId: activeInvoice.safe_id || null,
          newPaidAmount: paid,
          newSafeId: needsSafe ? form.safe_id : null,
        });
      }

      setMode(null);
      await fetchAll();
    } catch (err: unknown) {
      toastError("تعذر الحفظ: " + formatRpcError(err, "خطأ غير معروف"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(inv: PurchaseInvoice) {
    if (!canDeleteInvoices) {
      toastError("ليس لديك صلاحية حذف الفواتير");
      return;
    }
    if (
      !(await confirm({
        message: `حذف فاتورة المشتريات ${inv.invoice_number}؟\nسيتم: عكس المخزون، وعكس رصيد المورد والخزنة، وإلغاء طلب الشراء المرتبط إن وُجد.`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }

    try {
      setBusyDeleteId(inv.id);
      const { cancelledDocs } = await deletePurchaseInvoiceFully(supabase, inv);
      toastSuccess(
        cancelledDocs > 0
          ? `تم الحذف وإلغاء ${cancelledDocs === 1 ? "طلب الشراء المرتبط" : `${cancelledDocs} وثائق مرتبطة`}`
          : "تم حذف الفاتورة وعكس المخزون والحسابات"
      );
      await fetchAll();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر الحذف");
    } finally {
      setBusyDeleteId(null);
    }
  }

  if (loading && section === "invoices") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#dcecff] border-t-[#1473e6]" />
      </div>
    );
  }

  const readOnly = mode === "view";

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold text-[#1473e6]">المشتريات</p>
          <h1 className="text-2xl font-bold text-[#172033]">
            {section === "invoices" ? "فواتير المشتريات" : "طلبات المشتريات"}
          </h1>
        </div>
        {section === "invoices" && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => router.push("/pos?mode=purchase_order")}
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#9ac7fa] bg-[#eef6ff] px-4 py-2 text-sm font-bold text-[#1473e6] hover:bg-[#dcecff]"
            >
              <ClipboardList className="h-4 w-4" />
              طلب مشتريات جديد
            </button>
            <button
              onClick={() => router.push("/pos?mode=purchase")}
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#1473e6] px-4 py-2 text-sm font-bold text-white shadow-[0_7px_18px_rgba(20,115,230,0.18)] hover:bg-[#0b65d1]"
            >
              <Plus className="h-4 w-4" />
              فاتورة مشتريات
            </button>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => switchSection("invoices")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            section === "invoices"
              ? "bg-[#1473e6] text-white"
              : "border border-[#e1e6ee] text-[#687386] hover:bg-[#f7f9fc]"
          }`}
        >
          فواتير المشتريات
        </button>
        <button
          onClick={() => switchSection("orders")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            section === "orders"
              ? "bg-[#1473e6] text-white"
              : "border border-[#e1e6ee] text-[#687386] hover:bg-[#f7f9fc]"
          }`}
        >
          طلبات المشتريات
        </button>
      </div>

      <div className={section === "orders" ? "block" : "hidden"}>
        <DocumentsPanel
          fixedType="purchase_order"
          embedded
          onConverted={() => {
            switchSection("invoices");
            void fetchAll();
          }}
        />
      </div>

      <div className={section === "invoices" ? "block" : "hidden"}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="text"
          placeholder="بحث برقم الفاتورة أو المورد..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full max-w-md rounded-lg border border-[#e1e6ee] px-4 py-2 text-sm focus:border-[#9ac7fa] focus:outline-none focus:ring-3 focus:ring-[#1473e6]/10"
        />
        <DateField
          value={dateFrom}
          onChange={setDateFrom}
          className="w-auto min-w-[160px]"
          inputClassName="border-[#e1e6ee]"
        />
        <DateField
          value={dateTo}
          onChange={setDateTo}
          className="w-auto min-w-[160px]"
          inputClassName="border-[#e1e6ee]"
        />
        <TodayDateChip
          dateFrom={dateFrom}
          dateTo={dateTo}
          onApply={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
        />
        <PrintListButton
          onClick={() => setShowListPrint(true)}
          rowCount={sorted.length}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-[#e9edf4] bg-white shadow-sm">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-[#f7f9fc] text-[#687386]">
              <tr>
                <SortableHeader label="رقم الفاتورة" field="invoice_number" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="المورد" field="supplier.name" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="التاريخ" field="created_at" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="الإجمالي" field="total" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="المدفوع" field="paid_amount" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <th className="px-4 py-3 text-right font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef1f6]">
              {sorted.map((inv) => (
                <tr
                  key={inv.id}
                  className="hover:bg-[#f7f9fc]"
                  onContextMenu={(e) => openMenu(e, purchaseContextItems(inv))}
                >
                  <td className="px-4 py-3 font-mono text-xs">{inv.invoice_number}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <span>{inv.supplier?.name || "-"}</span>
                      {(() => {
                        const badge = purchasePaymentBadge(inv);
                        return (
                          <span
                            className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        );
                      })()}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#687386]">{formatDateRelative(inv.created_at)}</td>
                  <td className="px-4 py-3 font-semibold">{formatCurrency(inv.total)}</td>
                  <td className="px-4 py-3 text-emerald-700">{formatCurrency(inv.paid_amount)}</td>
                  <td className="px-4 py-3">
                    <TableRowActions actions={purchaseRowActions(inv)} />
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[#98a2b3]">
                    لا توجد فواتير مشتريات بعد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {mode && (
        <Modal
          open
          onClose={() => setMode(null)}
          title={
            mode === "create"
              ? "فاتورة مشتريات جديدة"
              : mode === "edit"
                ? `تعديل ${activeInvoice?.invoice_number}`
                : `عرض ${activeInvoice?.invoice_number}`
          }
          wide
        >
            <form onSubmit={handleSave} className="space-y-4" dir="rtl">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#344054]">المورد</label>
                  {readOnly ? (
                    <p className="rounded-lg border border-[#e1e6ee] bg-slate-50 px-3 py-2 text-sm text-[#172033]">
                      {suppliers.find((s) => s.id === form.supplier_id)?.name || "—"}
                    </p>
                  ) : (
                    <select
                      required
                      value={form.supplier_id}
                      onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
                      className="w-full rounded-lg border border-[#e1e6ee] px-3 py-2 text-sm"
                    >
                      <option value="">اختر المورد</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#344054]">التاريخ</label>
                  <DateField
                    type="datetime-local"
                    disabled={readOnly}
                    required
                    value={form.created_at}
                    onChange={(value) => setForm({ ...form, created_at: value })}
                    inputClassName="border-[#e1e6ee] disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#344054]">طريقة الدفع</label>
                  {readOnly ? (
                    <p className="rounded-lg border border-[#e1e6ee] bg-slate-50 px-3 py-2 text-sm text-[#172033]">
                      {form.payment_method === "credit"
                        ? "آجل"
                        : form.payment_method === "bank_transfer"
                          ? "تحويل بنكي"
                          : "نقدي"}
                    </p>
                  ) : (
                    <select
                      value={form.payment_method}
                      onChange={(e) => {
                        const method = e.target.value;
                        setForm({
                          ...form,
                          payment_method: method,
                          safe_id: pickDefaultSafeId(safes, method, form.safe_id),
                        });
                      }}
                      className="w-full rounded-lg border border-[#e1e6ee] px-3 py-2 text-sm"
                    >
                      <option value="cash">نقدي</option>
                      <option value="credit">آجل</option>
                      <option value="bank_transfer">تحويل بنكي</option>
                    </select>
                  )}
                </div>
              </div>

              {Number(form.paid_amount) > 0 && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#344054]">الخزنة</label>
                  {readOnly ? (
                    <p className="rounded-lg border border-[#e1e6ee] bg-slate-50 px-3 py-2 text-sm text-[#172033]">
                      {safes.find((s) => s.id === form.safe_id)?.name || "—"}
                    </p>
                  ) : (
                    <select
                      required
                      value={form.safe_id}
                      onChange={(e) => setForm({ ...form, safe_id: e.target.value })}
                      className="w-full rounded-lg border border-[#e1e6ee] px-3 py-2 text-sm"
                    >
                      <option value="">اختر الخزنة</option>
                      {safes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({formatCurrency(s.balance)})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-[#eef1f6] bg-[#f7f9fc]/60 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[#172033]">البنود</h3>
                  {!readOnly && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-[#687386]">
                        سعر الأساس:
                      </span>
                      <div className="inline-flex overflow-hidden rounded-lg border border-[#e1e6ee]">
                        <button
                          type="button"
                          onClick={() => changeBasis("buy")}
                          className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
                            priceBasis === "buy"
                              ? "bg-[#1473e6] text-white"
                              : "bg-white text-[#687386] hover:bg-[#f7f9fc]"
                          }`}
                        >
                          سعر الشراء
                        </button>
                        <button
                          type="button"
                          onClick={() => changeBasis("sell")}
                          className={`border-r border-[#e1e6ee] px-2.5 py-1 text-xs font-semibold transition-colors ${
                            priceBasis === "sell"
                              ? "bg-[#1473e6] text-white"
                              : "bg-white text-[#687386] hover:bg-[#f7f9fc]"
                          }`}
                        >
                          سعر البيع
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {!readOnly && (
                  <div className="relative mb-3">
                    <input
                      type="text"
                      placeholder="ابحث لإضافة صنف..."
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="w-full rounded-lg border border-[#e1e6ee] bg-white px-3 py-1.5 text-xs focus:border-[#9ac7fa] focus:outline-none"
                    />
                    {productSearch && (
                      <div className="absolute inset-x-0 z-20 mt-1 max-h-36 overflow-y-auto rounded-lg border border-[#e9edf4] bg-white shadow-lg">
                        {products
                          .filter((p) => smartSearchMatch(productSearch, [p.name, p.sku]))
                          .map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => addProduct(p)}
                              className="flex w-full items-center justify-between border-b border-[#eef1f6] px-3 py-1.5 text-right text-xs hover:bg-[#eef6ff]"
                            >
                              <span className="font-medium">{p.name}</span>
                              <span className="font-mono text-[#687386]">
                                {p.sku} | {formatCurrency(p.buy_price)}
                              </span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="max-h-48 overflow-y-auto rounded-lg border border-[#e9edf4] bg-white">
                  <table className="w-full text-xs">
                    <thead className="bg-[#f7f9fc] text-[#687386]">
                      <tr>
                        <th className="px-3 py-1.5 text-right">الصنف</th>
                        <th className="w-16 px-3 py-1.5 text-right">الكمية</th>
                        <th className="w-24 px-3 py-1.5 text-right">سعر الشراء</th>
                        <th className="w-24 px-3 py-1.5 text-right">الإجمالي</th>
                        {!readOnly && <th className="w-10 px-3 py-1.5 text-center">إزالة</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#eef1f6]">
                      {items.map((item, index) => (
                        <tr key={`${item.product.id}-${index}`}>
                          <td className="px-3 py-1.5 font-medium">{item.product.name}</td>
                          <td className="px-3 py-1.5">
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              disabled={readOnly}
                              value={item.quantity === 0 ? "" : item.quantity}
                              onChange={(e) => {
                                const n = parseNumberInput(e.target.value);
                                updateLine(
                                  index,
                                  n === null ? 0 : n,
                                  item.unit_price
                                );
                              }}
                              className="w-14 rounded border px-1 py-0.5 text-center disabled:bg-slate-50"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              disabled={readOnly}
                              value={item.unit_price === 0 ? "" : item.unit_price}
                              onChange={(e) => {
                                const n = parseNumberInput(e.target.value);
                                updateLine(
                                  index,
                                  item.quantity,
                                  n === null ? 0 : n
                                );
                              }}
                              className="w-20 rounded border px-1 py-0.5 text-center disabled:bg-slate-50"
                            />
                          </td>
                          <td className="px-3 py-1.5 font-semibold">
                            {formatCurrency(item.quantity * item.unit_price)}
                          </td>
                          {!readOnly && (
                            <td className="px-3 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => setItems(items.filter((_, i) => i !== index))}
                                className="text-rose-500"
                              >
                                ✕
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-[#98a2b3]">
                            لا توجد أصناف
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#344054]">الإجمالي قبل الخصم</label>
                  <div className="rounded-lg border border-[#e1e6ee] bg-[#f7f9fc] px-3 py-2 text-sm font-semibold text-[#344054]">
                    {formatCurrency(calculatedTotal)}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#344054]">خصم الفاتورة</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={readOnly}
                      value={discount === 0 ? "" : discount}
                      onChange={(e) => {
                        const n = parseNumberInput(e.target.value);
                        setDiscount(n === null ? 0 : n);
                      }}
                      className="w-full rounded-lg border border-[#e1e6ee] px-3 py-2 text-sm disabled:bg-slate-50"
                    />
                    <select
                      disabled={readOnly}
                      value={discountType}
                      onChange={(e) =>
                        setDiscountType(
                          e.target.value === "percent" ? "percent" : "amount"
                        )
                      }
                      className="rounded-lg border border-[#e1e6ee] px-2 py-2 text-sm disabled:bg-slate-50"
                    >
                      <option value="amount">مبلغ</option>
                      <option value="percent">%</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-[#344054]">الإجمالي بعد الخصم</label>
                  <div className="rounded-lg border border-[#e1e6ee] bg-[#f7f9fc] px-3 py-2 text-sm font-bold text-[#1473e6]">
                    {formatCurrency(grandTotal)}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#344054]">المدفوع للمورد</label>
                  <input
                    type="number"
                    step="0.01"
                    disabled={readOnly}
                    value={form.paid_amount}
                    onChange={(e) => setForm({ ...form, paid_amount: e.target.value })}
                    className="w-full rounded-lg border border-[#e1e6ee] px-3 py-2 text-sm disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#344054]">ملاحظات</label>
                  <input
                    type="text"
                    disabled={readOnly}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full rounded-lg border border-[#e1e6ee] px-3 py-2 text-sm disabled:bg-slate-50"
                  />
                </div>
              </div>

              {!readOnly && (
                <div className="flex gap-3 border-t border-[#eef1f6] pt-4">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 rounded-lg bg-[#1473e6] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0b65d1] disabled:opacity-50"
                  >
                    {saving ? "جاري الحفظ..." : "حفظ"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode(null)}
                    className="rounded-lg border border-[#e1e6ee] px-6 py-2.5 text-sm font-medium text-[#687386]"
                  >
                    إلغاء
                  </button>
                </div>
              )}
            </form>
        </Modal>
      )}
      </div>

      {showListPrint && (
        <PrintReportPreview
          title="تقرير فواتير المشتريات"
          rows={sorted}
          columns={purchaseInvoiceColumns}
          settings={settings}
          subtitle={
            dateFrom || dateTo
              ? `الفترة: ${dateFrom || "…"} — ${dateTo || "…"}`
              : undefined
          }
          summary={[
            { label: "عدد الفواتير", value: String(sorted.length) },
            { label: "إجمالي المعروض", value: formatCurrency(totalPurchases) },
          ]}
          onClose={() => setShowListPrint(false)}
        />
      )}

      {docPrint && (
        <DocumentPrintPreview
          kind="purchase"
          documentNumber={docPrint.invoice.invoice_number}
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
          paid={Number(docPrint.invoice.paid_amount)}
          paymentMethod={docPrint.invoice.payment_method}
          notes={docPrint.invoice.notes}
          cashierName={profile?.full_name || "الكاشير"}
          settings={settings}
          issuedAt={docPrint.invoice.created_at}
          onClose={() => setDocPrint(null)}
        />
      )}
      {contextMenu}
    </div>
  );
}
