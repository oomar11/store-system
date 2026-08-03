"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import {
  formatCurrency,
  smartSearchMatch,
  parseNumberInput,
  stockQtyBadgeClass,
  paymentMethodChipClass,
  paymentAmountTextClass,
} from "@/lib/utils";
import { allocateDocumentNumber } from "@/lib/document-numbers";
import {
  createInvoiceOnlineOrQueue,
  getSnapshot,
  isBrowserOnline,
  readLocalThenNetwork,
  tierPricingFromSnapshot,
  withTimeout,
} from "@/lib/offline";
import {
  adjustProductStock,
  replaceStockImpact,
  updateProductsBuyPrice,
} from "@/lib/inventory";
import {
  adjustCustomerBalance,
  adjustSupplierBalance,
} from "@/lib/party-balance";
import {
  mapCartToInvoiceItems,
  insertInvoiceItems,
  purchaseNetUnitCosts,
} from "@/lib/invoice-cost";
import {
  pickDefaultSafeId,
  syncInvoiceSafePayment,
  withInvoiceSafeId,
} from "@/lib/safe-transactions";
import { safesOrderQuery } from "@/lib/safes-order";
import { formatRpcError } from "@/lib/rpc-error";
import {
  loadTierPricingContext,
  resolveSellPrice,
  type TierPricingContext,
} from "@/lib/price-tiers";
import {
  isPurchaseSideMode,
  modeToPosUrl,
  parsePosMode,
  samePartySide,
  type PosMode,
} from "@/lib/pos-copy";
import { useAuth } from "@/hooks/useAuth";
import { canAccess, profileSubject } from "@/lib/permissions";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  addHeldCart,
  heldCartItemCount,
  heldCartTotal,
  loadHeldCarts,
  removeHeldCart,
  type HeldCartSnapshot,
} from "@/lib/pos-held-carts";
import {
  cartLinesForDraft,
  clearPosDraft,
  loadPosDraft,
  savePosDraft,
  type PosDraftCart,
} from "@/lib/pos-draft-cart";

async function resolveInvoiceSafeId(
  supabase: ReturnType<typeof createClient>,
  invoiceId: string,
  preferred?: string | null
): Promise<string | null> {
  if (preferred) return preferred;
  const { data } = await supabase
    .from("safe_transactions")
    .select("safe_id")
    .eq("reference_id", invoiceId)
    .eq("reference_type", "invoice")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.safe_id || null;
}
import { InvoicePreview } from "@/components/pos/InvoicePreview";
import { DocumentPrintPreview } from "@/components/print/DocumentPrintPreview";
import { isReceiptLayout } from "@/lib/print-formats";
import { QuickPartyForm } from "@/components/parties/QuickPartyForm";
import { DateField } from "@/components/ui/DateField";
import { useUrlSearchTerm } from "@/hooks/useUrlSearchTerm";
import type { Product, Customer, Supplier, Settings, Safe } from "@/types";
import {
  AlertTriangle,
  ClipboardList,
  FileText,
  Keyboard,
  Minus,
  Package,
  Pause,
  Plus,
  ReceiptText,
  ShoppingCart,
  X,
} from "lucide-react";

function modeToUrl(mode: PosMode, base = "/pos"): string {
  return modeToPosUrl(mode, base);
}

interface CartItem {
  product: Product;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  /** Cost snapshot from DB when editing; undefined for new cart lines */
  unit_cost?: number | null;
}

function cartLineUnitCost(item: CartItem): number {
  if (item.unit_cost != null && !Number.isNaN(Number(item.unit_cost))) {
    return Number(item.unit_cost);
  }
  return Number(item.product.buy_price) || 0;
}

type SaleLossAnalysis = {
  belowCostLines: Array<{
    name: string;
    revenue: number;
    cost: number;
    loss: number;
  }>;
  totalCost: number;
  revenueAfterDiscount: number;
  invoiceBelowCost: boolean;
  invoiceLossAmount: number;
  discountCausedLoss: boolean;
  hasLoss: boolean;
};

function analyzeSaleLoss(
  cart: CartItem[],
  revenueAfterDiscount: number,
  invoiceDiscountAmount: number
): SaleLossAnalysis {
  const belowCostLines: SaleLossAnalysis["belowCostLines"] = [];
  let totalCost = 0;

  for (const item of cart) {
    const unitCost = cartLineUnitCost(item);
    const lineCost = item.quantity * unitCost;
    totalCost += lineCost;
    if (unitCost > 0 && item.total + 0.005 < lineCost) {
      belowCostLines.push({
        name: item.product.name,
        revenue: item.total,
        cost: lineCost,
        loss: lineCost - item.total,
      });
    }
  }

  const invoiceBelowCost =
    totalCost > 0 && revenueAfterDiscount + 0.005 < totalCost;
  const invoiceLossAmount = invoiceBelowCost
    ? totalCost - revenueAfterDiscount
    : 0;
  const discountCausedLoss =
    invoiceBelowCost &&
    belowCostLines.length === 0 &&
    invoiceDiscountAmount > 0.005;

  return {
    belowCostLines,
    totalCost,
    revenueAfterDiscount,
    invoiceBelowCost,
    invoiceLossAmount,
    discountCausedLoss,
    hasLoss: belowCostLines.length > 0 || invoiceBelowCost,
  };
}

function formatSaleLossMessage(loss: SaleLossAnalysis): string {
  const parts: string[] = ["تحذير: البيع أقل من التكلفة"];
  for (const line of loss.belowCostLines.slice(0, 5)) {
    parts.push(
      `• ${line.name}: بيع ${formatCurrency(line.revenue)} / تكلفة ${formatCurrency(line.cost)} (خسارة ${formatCurrency(line.loss)})`
    );
  }
  if (loss.belowCostLines.length > 5) {
    parts.push(`• و${loss.belowCostLines.length - 5} أصناف أخرى`);
  }
  if (loss.invoiceBelowCost) {
    if (loss.discountCausedLoss) {
      parts.push(
        `• الخصم على الفاتورة ينزل الإجمالي تحت التكلفة بخسارة ${formatCurrency(loss.invoiceLossAmount)}`
      );
    } else if (loss.belowCostLines.length === 0) {
      parts.push(
        `• إجمالي الفاتورة بعد الخصم ${formatCurrency(loss.revenueAfterDiscount)} أقل من التكلفة ${formatCurrency(loss.totalCost)} (خسارة ${formatCurrency(loss.invoiceLossAmount)})`
      );
    } else {
      parts.push(
        `• إجمالي الخسارة على الفاتورة: ${formatCurrency(loss.invoiceLossAmount)}`
      );
    }
  }
  parts.push("هل تريد المتابعة رغم الخسارة؟");
  return parts.join("\n");
}

export default function POSPage({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const router = useRouter();
  const [mode, setMode] = useState<PosMode>("sale");
  const modeRef = useRef<PosMode>(mode);
  modeRef.current = mode;
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const selectedCustomerRef = useRef<Customer | null>(null);
  selectedCustomerRef.current = selectedCustomer;
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [searchTerm, setSearchTerm] = useUrlSearchTerm();
  const [partySearch, setPartySearch] = useState("");
  const [showPartyList, setShowPartyList] = useState(false);
  const [showQuickParty, setShowQuickParty] = useState(false);
  const [activePartyIndex, setActivePartyIndex] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit">("cash");
  const [paidAmount, setPaidAmount] = useState(0);
  const [safes, setSafes] = useState<Safe[]>([]);
  const [selectedSafeId, setSelectedSafeId] = useState("");
  const [editingSafeId, setEditingSafeId] = useState<string | null>(null);
  const [editingPaidAmount, setEditingPaidAmount] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<"amount" | "percent">("amount");
  const [purchasePriceBasis, setPurchasePriceBasis] = useState<"buy" | "sell">(
    "buy"
  );
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<string>("");
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [validUntil, setValidUntil] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const partyRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();
  const [bootReady, setBootReady] = useState(false);
  /** Skip draft writes until boot+restore finishes (avoids Strict Mode wiping drafts). */
  const suppressDraftWriteRef = useRef(true);
  const draftRestoredForModeRef = useRef<string | null>(null);
  const draftSnapRef = useRef({
    userId: undefined as string | undefined,
    mode: "sale" as PosMode,
    isEditing: false,
    showInvoice: false,
    cart: [] as CartItem[],
    selectedCustomer: null as Customer | null,
    selectedSupplier: null as Supplier | null,
    paymentMethod: "cash" as "cash" | "credit",
    paidAmount: 0,
    discount: 0,
    discountType: "amount" as "amount" | "percent",
    notes: "",
    selectedSafeId: "",
    validUntil: "",
    expectedDate: "",
    purchasePriceBasis: "buy" as "buy" | "sell",
  });

  const [activeProductIndex, setActiveProductIndex] = useState<number>(0);
  const qtyFocusSeq = useRef(0);
  const [qtyFocus, setQtyFocus] = useState<{ index: number; seq: number } | null>(
    null
  );
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tierPricing, setTierPricing] = useState<TierPricingContext>({});
  const [heldCarts, setHeldCarts] = useState<HeldCartSnapshot[]>([]);
  const [showHeldPanel, setShowHeldPanel] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { profile, canEditPrices } = useAuth();
  const subject = profileSubject(profile);
  const canPurchase = canAccess(subject, "purchases");
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const { confirm, prompt } = useConfirm();

  const isPurchaseSide = mode === "purchase" || mode === "purchase_order";
  const isDocMode = mode === "quote" || mode === "purchase_order";
  const allowsOutOfStock = isDocMode || isPurchaseSide;
  const isEditing = !!(editingInvoiceId || editingDocId);
  const posBase = embedded ? "/m/pos" : "/pos";
  const posUrl = (m: PosMode = mode) => modeToUrl(m, posBase);

  draftSnapRef.current = {
    userId: profile?.id,
    mode,
    isEditing,
    showInvoice,
    cart,
    selectedCustomer,
    selectedSupplier,
    paymentMethod,
    paidAmount,
    discount,
    discountType,
    notes,
    selectedSafeId,
    validUntil,
    expectedDate,
    purchasePriceBasis,
  };

  function saveDraftFromSnap(
    snap: typeof draftSnapRef.current = draftSnapRef.current
  ) {
    if (suppressDraftWriteRef.current) return;
    if (snap.isEditing || snap.showInvoice) return;
    if (snap.cart.length === 0) return;
    savePosDraft(snap.userId, snap.mode, {
      lines: cartLinesForDraft(snap.cart),
      customerId: snap.selectedCustomer?.id || null,
      supplierId: snap.selectedSupplier?.id || null,
      paymentMethod: snap.paymentMethod,
      paidAmount: snap.paidAmount,
      discount: snap.discount,
      discountType: snap.discountType,
      notes: snap.notes,
      safeId: snap.selectedSafeId,
      validUntil: snap.validUntil,
      expectedDate: snap.expectedDate,
      purchasePriceBasis: snap.purchasePriceBasis,
    });
  }

  function syncDraftFromSnap(
    snap: typeof draftSnapRef.current = draftSnapRef.current
  ) {
    if (suppressDraftWriteRef.current) return;
    if (snap.isEditing || snap.showInvoice) return;
    if (snap.cart.length === 0) {
      clearPosDraft(snap.userId, snap.mode);
      return;
    }
    saveDraftFromSnap(snap);
  }

  function discardPosDraft(forMode: PosMode = mode) {
    clearPosDraft(profile?.id, forMode);
  }

  function applyPosDraft(draft: PosDraftCart): boolean {
    const lines: CartItem[] = [];
    for (const line of draft.lines) {
      const product = products.find((p) => p.id === line.productId);
      if (!product) continue;
      lines.push({
        product,
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount: line.discount,
        total: line.total,
      });
    }
    if (lines.length === 0) {
      clearPosDraft(profile?.id, mode);
      return false;
    }
    setCart(lines);
    setSelectedCustomer(
      draft.customerId
        ? customers.find((c) => c.id === draft.customerId) || null
        : null
    );
    setSelectedSupplier(
      draft.supplierId
        ? suppliers.find((s) => s.id === draft.supplierId) || null
        : null
    );
    if (draft.paymentMethod) setPaymentMethod(draft.paymentMethod);
    if (typeof draft.paidAmount === "number") setPaidAmount(draft.paidAmount);
    if (typeof draft.discount === "number") setDiscount(draft.discount);
    if (draft.discountType) setDiscountType(draft.discountType);
    setNotes(draft.notes || "");
    if (draft.safeId) setSelectedSafeId(draft.safeId);
    setValidUntil(draft.validUntil || "");
    setExpectedDate(draft.expectedDate || "");
    if (draft.purchasePriceBasis) setPurchasePriceBasis(draft.purchasePriceBasis);
    return true;
  }

  useEffect(() => {
    setHeldCarts(loadHeldCarts(profile?.id, mode));
  }, [profile?.id, mode]);

  useEffect(() => {
    async function boot() {
      await Promise.all([
        fetchProducts(),
        fetchCustomers(),
        fetchSuppliers(),
        fetchSettings(),
        fetchSafes(),
        fetchTierPrices(),
      ]);
      searchRef.current?.focus();

      const params = new URLSearchParams(window.location.search);
      const nextMode = parsePosMode(params.get("mode"));
      const editId = params.get("edit");
      const copyFrom = params.get("copyFrom");
      const copyKind = params.get("copyKind");
      setMode(nextMode);

      if (copyFrom) {
        await loadCopyFrom(copyFrom, nextMode, copyKind === "document" ? "document" : "auto");
      } else if (editId) {
        if (nextMode === "quote") await loadQuoteForEdit(editId);
        else if (nextMode === "purchase_order") await loadPurchaseOrderForEdit(editId);
        else if (nextMode === "purchase") await loadPurchaseForEdit(editId);
        else await loadInvoiceForEdit(editId);
      }
      setBootReady(true);
    }
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore auto-draft once per mode after boot (skip edit/copy flows)
  useEffect(() => {
    if (!bootReady) return;
    if (editLoading) return;
    if (draftRestoredForModeRef.current === mode) {
      suppressDraftWriteRef.current = false;
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const skipRestore = !!(params.get("edit") || params.get("copyFrom"));
    draftRestoredForModeRef.current = mode;

    if (skipRestore || isEditing) {
      suppressDraftWriteRef.current = false;
      return;
    }

    const draft = loadPosDraft(profile?.id, mode);
    if (draft && cart.length === 0) {
      const ok = applyPosDraft(draft);
      if (ok) {
        toastInfo("تم استرجاع السلة السابقة — تُحفظ تلقائياً لمدة 24 ساعة");
      }
      // Wait for cart state commit before allowing empty-cart clears
      requestAnimationFrame(() => {
        suppressDraftWriteRef.current = false;
      });
      return;
    }
    suppressDraftWriteRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootReady, mode, profile?.id, products, customers, suppliers, editLoading, isEditing]);

  // Keep draft in sync while on POS
  useEffect(() => {
    if (!bootReady) return;
    syncDraftFromSnap();
  }, [
    bootReady,
    mode,
    profile?.id,
    cart,
    selectedCustomer,
    selectedSupplier,
    paymentMethod,
    paidAmount,
    discount,
    discountType,
    notes,
    selectedSafeId,
    validUntil,
    expectedDate,
    purchasePriceBasis,
    isEditing,
  ]);

  // After a successful save (invoice preview open), drop the auto-draft
  useEffect(() => {
    if (showInvoice) discardPosDraft();
  }, [showInvoice, mode, profile?.id]);

  // On tab hide / leave POS: save only (never clear — avoids Strict Mode wipe)
  useEffect(() => {
    function flushDraft() {
      saveDraftFromSnap(draftSnapRef.current);
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") flushDraft();
    }
    window.addEventListener("pagehide", flushDraft);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushDraft);
      document.removeEventListener("visibilitychange", onVisibility);
      flushDraft();
    };
  }, []);

  useEffect(() => {
    if (
      (mode === "purchase" || mode === "purchase_order") &&
      profile &&
      !canAccess(subject, "purchases")
    ) {
      switchMode("sale");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role, profile?.permissions, mode]);

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          activeEl.getAttribute("contenteditable") === "true");

      if (isInputFocused) return;

      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (searchRef.current) {
          searchRef.current.focus();
          setSearchTerm(e.key);
          setActiveProductIndex(0);
        }
      }
    }
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [setSearchTerm]);

  // Select qty only when a new focus request arrives — not on every cart keystroke
  useEffect(() => {
    if (!qtyFocus) return;
    const input = document.getElementById(
      `qty-input-${qtyFocus.index}`
    ) as HTMLInputElement | null;
    if (!input) return;
    input.focus();
    input.select();
  }, [qtyFocus]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (partyRef.current && !partyRef.current.contains(event.target as Node)) {
        setShowPartyList(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!showPartyList) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowPartyList(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showPartyList]);

  useEffect(() => {
    if (!showSaveConfirm) return;
    function onKeyDown(e: KeyboardEvent) {
      if (loading) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSaveConfirm(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        void executeConfirmedSave();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showSaveConfirm, loading]);

  async function fetchProducts() {
    const browserOnline = isBrowserOnline();
    await readLocalThenNetwork({
      offline: !browserOnline,
      timeoutMs: 5000,
      local: async () => {
        const snap = await getSnapshot();
        if (!snap?.products?.length) return null;
        return snap.products.filter((p) => p.is_active !== false) as unknown as typeof products;
      },
      network: async () => {
        const { data, error } = await withTimeout(
          (async () =>
            supabase
              .from("products")
              .select("*")
              .eq("is_active", true)
              .order("name"))(),
          5000
        );
        if (error) throw error;
        return (data || []) as typeof products;
      },
      apply: (data) => setProducts(data),
    });
  }

  async function fetchCustomers() {
    await readLocalThenNetwork({
      offline: !isBrowserOnline(),
      timeoutMs: 5000,
      local: async () => {
        const snap = await getSnapshot();
        if (!snap?.customers?.length) return null;
        const tierById = new Map(
          (snap.tierPricing?.tiers || []).map((t) => [t.id, t])
        );
        return snap.customers
          .filter((c) => c.is_active !== false)
          .map((c) => {
            const tierId = c.price_tier_id ?? null;
            const nested =
              c.price_tier ??
              (tierId ? tierById.get(tierId) ?? null : null);
            return {
              id: c.id,
              name: c.name,
              phone: c.phone,
              balance: c.balance,
              price_tier_id: tierId,
              price_tier: nested
                ? {
                    id: nested.id,
                    name: nested.name,
                    is_default: nested.is_default,
                    sort_order: 0,
                    created_at: "",
                  }
                : null,
            };
          }) as typeof customers;
      },
      network: async () => {
        const { data, error } = await withTimeout(
          (async () =>
            supabase
              .from("customers")
              .select("*, price_tier:price_tiers(*)")
              .eq("is_active", true)
              .order("name"))(),
          5000
        );
        if (error) throw error;
        return (data || []) as typeof customers;
      },
      apply: (data) => setCustomers(data),
    });
  }

  async function fetchTierPrices() {
    await readLocalThenNetwork({
      offline: !isBrowserOnline(),
      timeoutMs: 5000,
      local: async () => {
        const snap = await getSnapshot();
        if (!snap?.tierPricing) return null;
        return tierPricingFromSnapshot(snap);
      },
      network: async () => loadTierPricingContext(supabase),
      apply: (data) => {
        setTierPricing(data);
        // Re-price if a tiered customer was already selected before context arrived
        const customer = selectedCustomerRef.current;
        if (
          customer?.price_tier_id &&
          !isPurchaseSideMode(modeRef.current)
        ) {
          const tierId = customer.price_tier_id;
          setCart((prev) =>
            prev.map((item) => {
              const unitPrice = resolveSellPrice(item.product, tierId, data);
              return {
                ...item,
                unit_price: unitPrice,
                total: unitPrice * item.quantity - item.discount,
              };
            })
          );
        }
      },
    });
  }

  function applyCustomerPricing(customer: Customer | null) {
    // Sale + quote (sell-side) — purchase modes use buy/sell basis instead
    if (isPurchaseSide) return;
    const tierId = customer?.price_tier_id ?? null;
    setCart((prev) =>
      prev.map((item) => {
        const unitPrice = resolveSellPrice(item.product, tierId, tierPricing);
        return {
          ...item,
          unit_price: unitPrice,
          total: unitPrice * item.quantity - item.discount,
        };
      })
    );
  }

  function selectCustomer(customer: Customer | null) {
    setSelectedCustomer(customer);
    applyCustomerPricing(customer);
  }

  async function fetchSuppliers() {
    await readLocalThenNetwork({
      offline: !isBrowserOnline(),
      timeoutMs: 5000,
      local: async () => {
        const snap = await getSnapshot();
        if (!snap?.suppliers?.length) return null;
        return snap.suppliers
          .filter((s) => s.is_active !== false)
          .map((s) => ({
            id: s.id,
            name: s.name,
            phone: s.phone,
            balance: s.balance,
          })) as typeof suppliers;
      },
      network: async () => {
        const { data, error } = await withTimeout(
          (async () =>
            supabase
              .from("suppliers")
              .select("*")
              .eq("is_active", true)
              .order("name"))(),
          5000
        );
        if (error) throw error;
        return (data || []) as typeof suppliers;
      },
      apply: (data) => setSuppliers(data),
    });
  }

  async function fetchSafes() {
    const result = await readLocalThenNetwork({
      offline: !isBrowserOnline(),
      timeoutMs: 5000,
      local: async () => {
        const snap = await getSnapshot();
        if (!snap?.safes?.length) return null;
        return snap.safes.filter((s) => s.is_active) as typeof safes;
      },
      network: async () => {
        const { data, error } = await withTimeout(
          Promise.resolve(
            safesOrderQuery(
              supabase.from("safes").select("*").eq("is_active", true)
            )
          ) as Promise<{
            data: typeof safes | null;
            error: { message: string } | null;
          }>,
          5000
        );
        if (error) throw error;
        return (data || []) as typeof safes;
      },
      apply: (data) => {
        setSafes(data);
        setSelectedSafeId((prev) =>
          pickDefaultSafeId(
            data,
            paymentMethod,
            prev || settings?.drawer_safe_id
          )
        );
      },
    });
    return result.data || [];
  }

  async function fetchSettings() {
    await readLocalThenNetwork({
      offline: !isBrowserOnline(),
      timeoutMs: 5000,
      local: async () => {
        const snap = await getSnapshot();
        if (!snap?.settings) return null;
        return snap.settings as unknown as NonNullable<typeof settings>;
      },
      network: async () => {
        const { data, error } = await withTimeout(
          (async () =>
            supabase
              .from("settings")
              .select("*")
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle())(),
          5000
        );
        if (error) throw error;
        if (!data) throw new Error("no settings");
        return data as NonNullable<typeof settings>;
      },
      apply: (data) => setSettings(data),
    });
  }

  async function loadInvoiceForEdit(invoiceId: string) {
    if (!isBrowserOnline()) {
      toastError("تعديل الفاتورة يحتاج إنترنت — أضف فاتورة جديدة أوفلاين من نقطة البيع");
      router.replace(posUrl("sale"));
      return;
    }
    setEditLoading(true);
    try {
      const [{ data: inv, error }, activeSafes] = await Promise.all([
        supabase
          .from("invoices")
          .select("*, customer:customers(*)")
          .eq("id", invoiceId)
          .eq("type", "sale")
          .single(),
        fetchSafes(),
      ]);

      if (error || !inv) {
        toastError("تعذر فتح الفاتورة للتعديل");
        router.replace(posUrl("sale"));
        return;
      }

      const { data: lines } = await supabase
        .from("invoice_items")
        .select("*, product:products(*)")
        .eq("invoice_id", invoiceId);

      setEditingInvoiceId(inv.id);
      setEditingDocId(null);
      setLastInvoice(inv.invoice_number);
      setCart(
        lines?.map((line) => ({
          product: line.product as Product,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
          discount: Number(line.discount) || 0,
          total: Number(line.total),
          unit_cost:
            line.unit_cost != null ? Number(line.unit_cost) : null,
        })) || []
      );
      setSelectedCustomer((inv.customer as Customer) || null);
      setSelectedSupplier(null);
      setPaymentMethod(inv.payment_method === "credit" ? "credit" : "cash");
      setPaidAmount(Number(inv.paid_amount) || 0);
      const linkedSafeId = await resolveInvoiceSafeId(
        supabase,
        inv.id,
        inv.safe_id || null
      );
      setSelectedSafeId(
        pickDefaultSafeId(activeSafes, inv.payment_method, linkedSafeId)
      );
      setEditingSafeId(linkedSafeId);
      setEditingPaidAmount(Number(inv.paid_amount) || 0);
      setDiscount(Number(inv.discount_amount) || 0);
      setDiscountType("amount");
      setNotes(inv.notes || "");
    } finally {
      setEditLoading(false);
    }
  }

  async function loadPurchaseForEdit(invoiceId: string) {
    setEditLoading(true);
    try {
      const [{ data: inv, error }, activeSafes] = await Promise.all([
        supabase
          .from("invoices")
          .select("*, supplier:suppliers(*)")
          .eq("id", invoiceId)
          .eq("type", "purchase")
          .single(),
        fetchSafes(),
      ]);

      if (error || !inv) {
        toastError("تعذر فتح فاتورة المشتريات للتعديل");
        router.replace(posUrl("purchase"));
        return;
      }

      const { data: lines } = await supabase
        .from("invoice_items")
        .select("*, product:products(*)")
        .eq("invoice_id", invoiceId);

      setEditingInvoiceId(inv.id);
      setEditingDocId(null);
      setLastInvoice(inv.invoice_number);
      setCart(
        lines?.map((line) => ({
          product: line.product as Product,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
          discount: Number(line.discount) || 0,
          total: Number(line.total),
          unit_cost:
            line.unit_cost != null ? Number(line.unit_cost) : null,
        })) || []
      );
      setSelectedSupplier((inv.supplier as Supplier) || null);
      setSelectedCustomer(null);
      setPaymentMethod(inv.payment_method === "credit" ? "credit" : "cash");
      setPaidAmount(Number(inv.paid_amount) || 0);
      const linkedSafeId = await resolveInvoiceSafeId(
        supabase,
        inv.id,
        inv.safe_id || null
      );
      setSelectedSafeId(
        pickDefaultSafeId(activeSafes, inv.payment_method, linkedSafeId)
      );
      setEditingSafeId(linkedSafeId);
      setEditingPaidAmount(Number(inv.paid_amount) || 0);
      setDiscount(Number(inv.discount_amount) || 0);
      setDiscountType("amount");
      setNotes(inv.notes || "");
    } finally {
      setEditLoading(false);
    }
  }

  async function loadQuoteForEdit(quoteId: string) {
    setEditLoading(true);
    try {
      const { data: doc, error } = await supabase
        .from("documents")
        .select("*, customer:customers(*)")
        .eq("id", quoteId)
        .eq("type", "quote")
        .single();

      if (error || !doc) {
        toastError("تعذر فتح عرض السعر للتعديل");
        router.replace(posUrl("quote"));
        return;
      }

      if (doc.stage === "converted") {
        toastError("عرض السعر محوّل لفاتورة ولا يمكن تعديله من هنا.");
        router.replace(
          embedded ? "/m/invoices?tab=quote" : "/sales?tab=quotes"
        );
        return;
      }

      const { data: lines } = await supabase
        .from("document_items")
        .select("*, product:products(*)")
        .eq("document_id", quoteId);

      setEditingDocId(doc.id);
      setEditingInvoiceId(null);
      setLastInvoice(doc.document_number);
      setCart(
        lines?.map((line) => ({
          product: line.product as Product,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
          discount: Number(line.discount) || 0,
          total: Number(line.total),
        })) || []
      );
      setSelectedCustomer((doc.customer as Customer) || null);
      setSelectedSupplier(null);
      setDiscount(Number(doc.discount_amount) || 0);
      setDiscountType("amount");
      setValidUntil(doc.valid_until || "");
      setNotes(doc.notes || "");
    } finally {
      setEditLoading(false);
    }
  }

  async function loadPurchaseOrderForEdit(docId: string) {
    setEditLoading(true);
    try {
      const { data: doc, error } = await supabase
        .from("documents")
        .select("*, supplier:suppliers(*)")
        .eq("id", docId)
        .eq("type", "purchase_order")
        .single();

      if (error || !doc) {
        toastError("تعذر فتح طلب المشتريات للتعديل");
        router.replace(posUrl("purchase_order"));
        return;
      }

      if (doc.stage === "converted") {
        toastError("طلب المشتريات محوّل لفاتورة ولا يمكن تعديله من هنا.");
        router.replace(
          embedded ? "/m/invoices?tab=purchase_order" : "/purchases?tab=orders"
        );
        return;
      }

      const { data: lines } = await supabase
        .from("document_items")
        .select("*, product:products(*)")
        .eq("document_id", docId);

      setEditingDocId(doc.id);
      setEditingInvoiceId(null);
      setLastInvoice(doc.document_number);
      setCart(
        lines?.map((line) => ({
          product: line.product as Product,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
          discount: Number(line.discount) || 0,
          total: Number(line.total),
        })) || []
      );
      setSelectedSupplier((doc.supplier as Supplier) || null);
      setSelectedCustomer(null);
      setDiscount(Number(doc.discount_amount) || 0);
      setDiscountType("amount");
      setExpectedDate(doc.expected_date || "");
      setNotes(doc.notes || "");
    } finally {
      setEditLoading(false);
    }
  }

  async function loadCopyFrom(
    sourceId: string,
    asMode: PosMode,
    kind: "auto" | "document" | "invoice" = "auto"
  ) {
    if (
      (asMode === "purchase" || asMode === "purchase_order") &&
      !canAccess(subject, "purchases")
    ) {
      toastError("ليس لديك صلاحية المشتريات");
      router.replace(posUrl("sale"));
      return;
    }

    setEditLoading(true);
    try {
      type SourceLine = {
        product: Product;
        quantity: number;
        unit_price: number;
        discount: number;
        total: number;
        unit_cost?: number | null;
      };

      let sourceMode: PosMode | null = null;
      let sourceNumber = "";
      let lines: SourceLine[] = [];
      let customer: Customer | null = null;
      let supplier: Supplier | null = null;
      let discountAmount = 0;
      let sourceNotes = "";
      let payment: "cash" | "credit" = "cash";
      let paid = 0;
      let safeHint: string | null = null;
      let validUntilCopy = "";
      let expectedDateCopy = "";

      const tryInvoice = kind !== "document";
      const tryDocument = kind !== "invoice";

      if (tryInvoice) {
        const { data: inv } = await supabase
          .from("invoices")
          .select("*, customer:customers(*), supplier:suppliers(*)")
          .eq("id", sourceId)
          .maybeSingle();

        if (inv) {
          const invType = inv.type as string;
          if (invType === "sale" || invType === "sale_return") sourceMode = "sale";
          else if (invType === "purchase" || invType === "purchase_return")
            sourceMode = "purchase";

          if (sourceMode) {
            const { data: invLines } = await supabase
              .from("invoice_items")
              .select("*, product:products(*)")
              .eq("invoice_id", sourceId);

            sourceNumber = inv.invoice_number;
            customer = (inv.customer as Customer) || null;
            supplier = (inv.supplier as Supplier) || null;
            discountAmount = Number(inv.discount_amount) || 0;
            sourceNotes = inv.notes || "";
            payment = inv.payment_method === "credit" ? "credit" : "cash";
            paid = Number(inv.paid_amount) || 0;
            safeHint = inv.safe_id || null;
            lines =
              invLines?.map((line) => ({
                product: line.product as Product,
                quantity: Number(line.quantity),
                unit_price: Number(line.unit_price),
                discount: Number(line.discount) || 0,
                total: Number(line.total),
                unit_cost:
                  line.unit_cost != null ? Number(line.unit_cost) : null,
              })) || [];
          }
        }
      }

      if (!sourceMode && tryDocument) {
        const { data: doc } = await supabase
          .from("documents")
          .select("*, customer:customers(*), supplier:suppliers(*)")
          .eq("id", sourceId)
          .maybeSingle();

        if (doc) {
          const docType = doc.type as string;
          if (docType === "quote") sourceMode = "quote";
          else if (docType === "purchase_order") sourceMode = "purchase_order";

          if (sourceMode) {
            const { data: docLines } = await supabase
              .from("document_items")
              .select("*, product:products(*)")
              .eq("document_id", sourceId);

            sourceNumber = doc.document_number;
            customer = (doc.customer as Customer) || null;
            supplier = (doc.supplier as Supplier) || null;
            discountAmount = Number(doc.discount_amount) || 0;
            sourceNotes = doc.notes || "";
            validUntilCopy = doc.valid_until || "";
            expectedDateCopy = doc.expected_date || "";
            lines =
              docLines?.map((line) => ({
                product: line.product as Product,
                quantity: Number(line.quantity),
                unit_price: Number(line.unit_price),
                discount: Number(line.discount) || 0,
                total: Number(line.total),
              })) || [];
          }
        }
      }

      if (!sourceMode || lines.length === 0) {
        toastError("تعذر نسخ المستند — لا توجد بنود");
        router.replace(posUrl(asMode));
        return;
      }

      const keepParty = samePartySide(sourceMode, asMode);
      const keepPrices = samePartySide(sourceMode, asMode);
      const sellSide = !isPurchaseSideMode(asMode);

      const cartLines: CartItem[] = lines
        .filter((line) => line.product)
        .map((line) => {
          const product = line.product;
          const qty = Number(line.quantity) || 0;
          let unitPrice = Number(line.unit_price) || 0;
          let discount = Number(line.discount) || 0;

          if (!keepPrices) {
            discount = 0;
            if (sellSide) {
              unitPrice = resolveSellPrice(
                product,
                keepParty ? customer?.price_tier_id ?? null : null,
                tierPricing
              );
            } else {
              unitPrice = Number(product.buy_price) || 0;
            }
          }

          const total = Math.max(0, qty * unitPrice - discount);
          return {
            product,
            quantity: qty,
            unit_price: unitPrice,
            discount,
            total,
            unit_cost: keepPrices ? line.unit_cost : undefined,
          };
        });

      if (cartLines.length === 0) {
        toastError("تعذر نسخ المستند — أصناف غير متاحة");
        router.replace(posUrl(asMode));
        return;
      }

      // New document — never edit the source
      setEditingInvoiceId(null);
      setEditingDocId(null);
      setEditingSafeId(null);
      setEditingPaidAmount(0);
      setLastInvoice("");
      setMode(asMode);
      setCart(cartLines);
      setDiscount(keepPrices ? discountAmount : 0);
      setDiscountType("amount");

      if (keepParty && sellSide) {
        setSelectedCustomer(customer);
        setSelectedSupplier(null);
      } else if (keepParty && !sellSide) {
        setSelectedSupplier(supplier);
        setSelectedCustomer(null);
      } else {
        setSelectedCustomer(null);
        setSelectedSupplier(null);
      }

      if (asMode === "sale" || asMode === "purchase") {
        setPaymentMethod(keepParty ? payment : "cash");
        setPaidAmount(keepParty ? paid : 0);
        const activeSafes = await fetchSafes();
        setSelectedSafeId(
          pickDefaultSafeId(activeSafes, keepParty ? payment : "cash", safeHint)
        );
      } else {
        setPaymentMethod("cash");
        setPaidAmount(0);
      }

      if (asMode === "quote") {
        setValidUntil(keepParty ? validUntilCopy : "");
        setExpectedDate("");
      } else if (asMode === "purchase_order") {
        setExpectedDate(keepParty ? expectedDateCopy : "");
        setValidUntil("");
      } else {
        setValidUntil("");
        setExpectedDate("");
      }

      const copyNote = sourceNumber ? `نسخ من ${sourceNumber}` : "نسخ من مستند";
      const notesCombined = sourceNotes
        ? `${copyNote}\n${sourceNotes}`
        : copyNote;
      setNotes(notesCombined);

      toastSuccess(`تم تجهيز السلة (${cartLines.length} صنف) — راجع واحفظ`);
      router.replace(posUrl(asMode));
      searchRef.current?.focus();
    } catch {
      toastError("تعذر نسخ المستند");
      router.replace(posUrl(asMode));
    } finally {
      setEditLoading(false);
    }
  }

  async function switchMode(nextMode: PosMode) {
    if (
      (nextMode === "purchase" || nextMode === "purchase_order") &&
      !canAccess(subject, "purchases")
    ) {
      toastError("ليس لديك صلاحية المشتريات");
      return;
    }
    if (isEditing) {
      if (
        !(await confirm({
          message: "يوجد تعديل جاري. هل تريد الإلغاء والانتقال؟",
        }))
      )
        return;
    }
    // Save current mode draft before wiping the cart
    suppressDraftWriteRef.current = false;
    saveDraftFromSnap(draftSnapRef.current);
    suppressDraftWriteRef.current = true;
    draftRestoredForModeRef.current = null;

    setCart([]);
    setSelectedCustomer(null);
    setSelectedSupplier(null);
    setPaidAmount(0);
    setDiscount(0);
    setNotes("");
    setValidUntil("");
    setExpectedDate("");
    setEditingInvoiceId(null);
    setEditingDocId(null);
    setLastInvoice("");
    setMode(nextMode);
    router.replace(posUrl(nextMode));
    searchRef.current?.focus();
  }

  function defaultUnitPrice(product: Product) {
    if (isPurchaseSide) {
      return purchasePriceBasis === "sell"
        ? product.sell_price
        : product.buy_price;
    }
    return resolveSellPrice(
      product,
      selectedCustomer?.price_tier_id ?? null,
      tierPricing
    );
  }

  function changePurchaseBasis(next: "buy" | "sell") {
    if (next === purchasePriceBasis) return;
    setPurchasePriceBasis(next);
    if (cart.length === 0) return;
    setCart((prev) =>
      prev.map((item) => {
        const unitPrice =
          next === "sell" ? item.product.sell_price : item.product.buy_price;
        return {
          ...item,
          unit_price: unitPrice,
          discount: 0,
          total: Math.max(0, item.quantity * unitPrice),
        };
      })
    );
  }

  function focusQtyInput(index: number) {
    qtyFocusSeq.current += 1;
    setQtyFocus({ index, seq: qtyFocusSeq.current });
  }

  function focusSearchInput() {
    setQtyFocus(null);
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }

  function focusPriceInput(index: number) {
    setQtyFocus(null);
    const input = document.getElementById(
      `price-input-${index}`
    ) as HTMLInputElement | null;
    if (!input) return false;
    input.focus();
    input.select();
    return true;
  }

  /** Clamp a line qty to a valid value after manual typing. */
  function commitCartQuantity(index: number) {
    const item = cart[index];
    if (!item) return;
    let next = Math.max(1, Number(item.quantity) || 0);
    if (!allowsOutOfStock) {
      next = Math.min(next, Math.max(1, Number(item.product.quantity) || 0));
    }
    if (next !== item.quantity) updateCartItem(index, { quantity: next });
  }

  function addToCart(
    product: Product,
    asPack = false,
    focusTarget: "qty" | "search" = "qty"
  ) {
    const pack = Math.max(1, Number(product.pack_size) || 1);
    const addQty = asPack ? pack : 1;

    if (!allowsOutOfStock && product.quantity <= 0) {
      toastError(`"${product.name}" نفد من المخزون`);
      return;
    }

    const existingIndex = cart.findIndex((item) => item.product.id === product.id);
    const targetIndex = existingIndex !== -1 ? existingIndex : cart.length;
    if (existingIndex !== -1) {
      setCart(
        cart.map((item, i) =>
          i === existingIndex
            ? {
                ...item,
                quantity: item.quantity + addQty,
                total:
                  (item.quantity + addQty) * item.unit_price - item.discount,
              }
            : item
        )
      );
    } else {
      const unitPrice = defaultUnitPrice(product);
      setCart([
        ...cart,
        {
          product,
          quantity: addQty,
          unit_price: unitPrice,
          discount: 0,
          total: unitPrice * addQty,
          unit_cost: Number(product.buy_price) || 0,
        },
      ]);
    }
    setSearchTerm("");
    setActiveProductIndex(0);
    if (focusTarget === "qty") focusQtyInput(targetIndex);
    else focusSearchInput();
  }

  function updateCartItem(index: number, updates: Partial<CartItem>) {
    setCart(
      cart.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, ...updates };
        updated.total = updated.quantity * updated.unit_price - updated.discount;
        return updated;
      })
    );
  }

  function bumpCartQuantity(index: number, delta: number) {
    const item = cart[index];
    if (!item) return;
    const current = Math.max(0, Number(item.quantity) || 0);
    let next = Math.max(1, current + delta);
    if (!allowsOutOfStock) {
      next = Math.min(next, Math.max(1, Number(item.product.quantity) || 0));
    }
    if (next === current) return;
    updateCartItem(index, { quantity: next });
  }

  function removeFromCart(index: number) {
    setCart(cart.filter((_, i) => i !== index));
  }

  function clearCartFields() {
    setCart([]);
    setSelectedCustomer(null);
    setSelectedSupplier(null);
    setPaidAmount(0);
    setPaymentMethod("cash");
    setSelectedSafeId(pickDefaultSafeId(safes, "cash"));
    setDiscount(0);
    setDiscountType("amount");
    setNotes("");
    setValidUntil("");
    setExpectedDate("");
  }

  async function holdCurrentCart(skipPrompt = false): Promise<boolean> {
    if (isEditing) {
      toastInfo("لا يمكن حجز سلة أثناء تعديل فاتورة — احفظ أو ألغِ التعديل أولاً.");
      return false;
    }
    if (cart.length === 0) {
      toastInfo("السلة فارغة");
      return false;
    }
    const defaultLabel = selectedCustomer?.name || selectedSupplier?.name || "";
    let label = `حجز ${heldCarts.length + 1}`;
    if (!skipPrompt) {
      const raw = await prompt({
        message: "اسم الحجز (اختياري):",
        defaultValue: defaultLabel,
      });
      if (raw === null) return false;
      label = raw.trim() || label;
    } else if (defaultLabel) {
      label = defaultLabel;
    }

    addHeldCart(profile?.id, mode, {
      label,
      lines: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount: item.discount,
        total: item.total,
        productName: item.product.name,
      })),
      customerId: selectedCustomer?.id || null,
      supplierId: selectedSupplier?.id || null,
      paymentMethod,
      paidAmount,
      discount,
      discountType,
      notes,
      safeId: selectedSafeId,
      validUntil,
      expectedDate,
    });
    setHeldCarts(loadHeldCarts(profile?.id, mode));
    clearCartFields();
    discardPosDraft();
    toastSuccess(`تم حجز السلة: ${label}`);
    searchRef.current?.focus();
    return true;
  }

  async function recallHeldCart(held: HeldCartSnapshot) {
    if (isEditing) {
      toastInfo("لا يمكن استرجاع حجز أثناء تعديل فاتورة.");
      return;
    }
    if (cart.length > 0) {
      if (
        !(await confirm({
          message:
            "السلة الحالية فيها أصناف. هل تحجزها أولاً ثم تسترجع الحجز؟\nموافق = حجز الحالي ثم استرجاع\nإلغاء = لا تفعل شيء",
        }))
      )
        return;
      if (!(await holdCurrentCart())) return;
    }

    const lines: CartItem[] = [];
    const missing: string[] = [];
    for (const line of held.lines) {
      const product = products.find((p) => p.id === line.productId);
      if (!product) {
        missing.push(line.productName || line.productId);
        continue;
      }
      lines.push({
        product,
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount: line.discount,
        total: line.total,
      });
    }
    if (lines.length === 0) {
      toastError("تعذر استرجاع الحجز — الأصناف غير موجودة");
      return;
    }

    setCart(lines);
    setSelectedCustomer(
      held.customerId
        ? customers.find((c) => c.id === held.customerId) || null
        : null
    );
    setSelectedSupplier(
      held.supplierId
        ? suppliers.find((s) => s.id === held.supplierId) || null
        : null
    );
    if (held.paymentMethod) setPaymentMethod(held.paymentMethod);
    if (typeof held.paidAmount === "number") setPaidAmount(held.paidAmount);
    if (typeof held.discount === "number") setDiscount(held.discount);
    if (held.discountType) setDiscountType(held.discountType);
    setNotes(held.notes || "");
    if (held.safeId) setSelectedSafeId(held.safeId);
    setValidUntil(held.validUntil || "");
    setExpectedDate(held.expectedDate || "");

    setHeldCarts(removeHeldCart(profile?.id, mode, held.id));
    setShowHeldPanel(false);
    toastSuccess(`تم استرجاع: ${held.label}`);
    if (missing.length > 0) {
      toastInfo(`أصناف غير موجودة وتم تجاهلها: ${missing.join("، ")}`);
    }
    searchRef.current?.focus();
  }

  function deleteHeldCart(heldId: string) {
    setHeldCarts(removeHeldCart(profile?.id, mode, heldId));
    toastSuccess("تم حذف الحجز");
  }

  const subtotal = cart.reduce((sum, item) => sum + item.total, 0);
  const cartItemCount = cart.length;
  const discountAmount = discountType === "percent" ? (subtotal * discount) / 100 : discount;
  const totalAfterDiscount = subtotal - discountAmount;
  const taxRate = settings?.tax_enabled ? settings.tax_rate : 0;
  const taxAmount = settings?.tax_enabled ? (totalAfterDiscount * taxRate) / 100 : 0;
  const grandTotal = totalAfterDiscount + taxAmount;
  const tracksSaleCost = mode === "sale" || mode === "quote";
  const saleLoss = tracksSaleCost
    ? analyzeSaleLoss(cart, totalAfterDiscount, discountAmount)
    : null;
  // نقدي مبيعات: paidAmount = المستلم من العميل (قد يزيد عن الإجمالي لحساب الباقي)
  // نقدي مشتريات: المدفوع للمورد = الإجمالي بعد الخصم دائماً
  // آجل: paidAmount = المدفوع مقدماً؛ يتخزن على الفاتورة actualPaidAmount
  const actualPaidAmount =
    paymentMethod === "cash"
      ? grandTotal
      : Math.min(Math.max(0, paidAmount), grandTotal);
  const changeDue =
    paymentMethod === "cash" && !isPurchaseSide
      ? Math.max(0, paidAmount - grandTotal)
      : 0;
  const remaining =
    paymentMethod === "credit"
      ? Math.max(0, grandTotal - actualPaidAmount)
      : 0;
  const needsSafe = actualPaidAmount > 0;
  const missingSafeSelection = !isDocMode && needsSafe && !selectedSafeId;
  const selectedSafe = safes.find((s) => s.id === selectedSafeId);
  const selectedSafeName = selectedSafe?.name || "—";
  const cashAmountLabel = isPurchaseSide ? "المدفوع" : "المستلم";
  const cashAmountPlaceholder = isPurchaseSide
    ? "المبلغ المدفوع للمورد"
    : "المبلغ المستلم من العميل";
  const cashAmountConfirmLabel = isPurchaseSide
    ? "المبلغ المدفوع"
    : "المبلغ المستلم";

  // نقدي: لازم المستلم/المدفوع يتزامن مع الإجمالي بعد الخصم (مش قبل الخصم)
  useEffect(() => {
    if (isDocMode) return;
    if (paymentMethod === "cash") {
      setPaidAmount(grandTotal);
    } else {
      setPaidAmount((prev) => (prev > grandTotal ? grandTotal : prev));
    }
  }, [grandTotal, paymentMethod, isDocMode]);

  function validateSalePayment(): boolean {
    if ((paymentMethod === "credit" || remaining > 0) && !selectedCustomer) {
      toastError("يجب اختيار عميل للعمليات الآجلة أو عند وجود متبقي.");
      return false;
    }
    if (paymentMethod === "cash" && paidAmount + 0.001 < grandTotal) {
      toastError("المبلغ المستلم أقل من إجمالي الفاتورة.");
      return false;
    }
    if (paymentMethod === "credit" && paidAmount > grandTotal + 0.001) {
      toastError("المبلغ المدفوع مقدماً أكبر من إجمالي الفاتورة.");
      return false;
    }
    if (needsSafe && !selectedSafeId) {
      toastError("الرجاء تحديد الخزنة للمدفوعات.");
      return false;
    }
    return true;
  }

  function validatePurchasePayment(): boolean {
    if (!selectedSupplier) {
      toastError("اختر المورد لفاتورة المشتريات.");
      return false;
    }
    if (paymentMethod === "cash" && paidAmount + 0.001 < grandTotal) {
      toastError("المبلغ المدفوع أقل من إجمالي الفاتورة.");
      return false;
    }
    if (needsSafe && !selectedSafeId) {
      toastError("الرجاء تحديد الخزنة للمدفوعات.");
      return false;
    }
    if (needsSafe && selectedSafe) {
      const bal = Number(selectedSafe.balance) || 0;
      if (actualPaidAmount > bal + 0.001) {
        toastError(
          `رصيد الخزنة غير كافٍ (المتاح ${bal.toFixed(2)} — المطلوب ${actualPaidAmount.toFixed(2)}). أودع في الخزنة أو اختر الدفع الآجل.`
        );
        return false;
      }
    }
    return true;
  }

  async function confirmBelowCostIfNeeded(): Promise<boolean> {
    if (!saleLoss?.hasLoss) return true;
    return confirm({
      title: "تحذير خسارة",
      message: formatSaleLossMessage(saleLoss),
      tone: "danger",
      confirmLabel: "متابعة رغم الخسارة",
      cancelLabel: "رجوع للتعديل",
    });
  }

  async function handleSubmit() {
    if (cart.length === 0) {
      toastError(
        mode === "quote"
          ? "أضف صنفاً واحداً على الأقل لعرض السعر."
          : mode === "purchase_order"
            ? "أضف صنفاً واحداً على الأقل لطلب المشتريات."
            : mode === "purchase"
              ? "أضف صنفاً واحداً على الأقل لفاتورة المشتريات."
              : "أضف صنفاً واحداً على الأقل قبل حفظ الفاتورة."
      );
      return;
    }

    if (mode === "quote") {
      if (!(await confirmBelowCostIfNeeded())) return;
      await handleSaveQuote();
      return;
    }
    if (mode === "purchase_order") {
      await handleSavePurchaseOrder();
      return;
    }
    if (mode === "purchase") {
      if (!validatePurchasePayment()) return;
      setShowSaveConfirm(true);
      return;
    }

    if (!validateSalePayment()) return;
    if (!(await confirmBelowCostIfNeeded())) return;
    setShowSaveConfirm(true);
  }

  useEffect(() => {
    function handleSubmitShortcut(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
      if (showSaveConfirm || loading || cart.length === 0 || missingSafeSelection)
        return;
      e.preventDefault();
      void handleSubmit();
    }
    document.addEventListener("keydown", handleSubmitShortcut);
    return () => document.removeEventListener("keydown", handleSubmitShortcut);
    // handleSubmit reads latest cart/payment state from closure each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSaveConfirm, loading, cart.length, missingSafeSelection]);

  async function executeConfirmedSave() {
    if (loading) return;
    setLoading(true);
    setShowSaveConfirm(false);
    if (mode === "purchase") {
      await commitPurchaseSave();
      return;
    }
    await commitSaleSave();
  }

  async function commitSaleSave() {
    setLoading(true);

    try {
      if (editingInvoiceId) {
        const { data: oldLines } = await supabase
          .from("invoice_items")
          .select("product_id, quantity")
          .eq("invoice_id", editingInvoiceId);

        const { data: oldInvoice } = await supabase
          .from("invoices")
          .select("customer_id, total, paid_amount, invoice_number")
          .eq("id", editingInvoiceId)
          .single();

        const { error: updateError } = await supabase
          .from("invoices")
          .update(
            await withInvoiceSafeId(
              supabase,
              {
                customer_id: selectedCustomer?.id || null,
                subtotal,
                tax_amount: taxAmount,
                discount_amount: discountAmount,
                total: grandTotal,
                paid_amount: actualPaidAmount,
                payment_method: paymentMethod,
                notes: notes || null,
              },
              needsSafe ? selectedSafeId : null
            )
          )
          .eq("id", editingInvoiceId);

        if (updateError) throw new Error(updateError.message);

        await supabase.from("invoice_items").delete().eq("invoice_id", editingInvoiceId);
        const saleEditItems = mapCartToInvoiceItems(editingInvoiceId, cart, { kind: "sale" });
        const saleEditErr = await insertInvoiceItems(supabase, saleEditItems);
        if (saleEditErr.error) throw new Error(saleEditErr.error.message);

        await replaceStockImpact(
          supabase,
          (oldLines || []).map((l) => ({
            product_id: l.product_id,
            quantity: Number(l.quantity),
          })),
          cart.map((item) => ({
            product_id: item.product.id,
            quantity: item.quantity,
          })),
          -1
        );

        if (oldInvoice?.customer_id) {
          const oldRemaining = Number(oldInvoice.total) - Number(oldInvoice.paid_amount);
          if (oldRemaining > 0) {
            await adjustCustomerBalance(supabase, oldInvoice.customer_id, -oldRemaining);
          }
        }

        if (selectedCustomer && remaining > 0) {
          await adjustCustomerBalance(supabase, selectedCustomer.id, remaining);
        }

        await syncInvoiceSafePayment(supabase, {
          invoiceId: editingInvoiceId,
          invoiceNumber: oldInvoice?.invoice_number || lastInvoice,
          invoiceType: "sale",
          oldPaidAmount: Number(oldInvoice?.paid_amount ?? editingPaidAmount) || 0,
          oldSafeId: editingSafeId,
          newPaidAmount: actualPaidAmount,
          newSafeId: needsSafe ? selectedSafeId : null,
        });

        setEditingPaidAmount(actualPaidAmount);
        setEditingSafeId(needsSafe ? selectedSafeId : null);
        setShowInvoice(true);
        void Promise.all([
          fetchProducts(),
          fetchCustomers(),
          fetchTierPrices(),
          fetchSafes(),
        ]);
      } else {
        const saleItems = mapCartToInvoiceItems("pending", cart, { kind: "sale" });
        const invoice = await createInvoiceOnlineOrQueue(supabase, {
          type: "sale",
          items: saleItems,
          subtotal,
          taxAmount,
          discountAmount,
          total: grandTotal,
          paidAmount: actualPaidAmount,
          paymentMethod,
          customerId: selectedCustomer?.id || null,
          safeId: needsSafe ? selectedSafeId : null,
          notes: notes || null,
          createdAt: new Date().toISOString(),
        });

        setLastInvoice(invoice.invoice_number);
        setShowInvoice(true);
        toastSuccess(
          invoice.offline
            ? `تم الحفظ أوفلاين ${invoice.invoice_number} — سيُزامن عند عودة النت`
            : `تم حفظ الفاتورة ${invoice.invoice_number}`
        );
        void Promise.all([
          fetchProducts(),
          fetchCustomers(),
          fetchTierPrices(),
          fetchSafes(),
        ]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "خطأ غير معروف";
      toastError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSavePurchase() {
    if (!validatePurchasePayment()) return;
    setShowSaveConfirm(true);
  }

  async function commitPurchaseSave() {
    if (!selectedSupplier) return;
    setLoading(true);
    try {
      if (editingInvoiceId) {
        const { data: oldLines } = await supabase
          .from("invoice_items")
          .select("product_id, quantity")
          .eq("invoice_id", editingInvoiceId);

        const { data: oldInvoice } = await supabase
          .from("invoices")
          .select("supplier_id, total, paid_amount, invoice_number")
          .eq("id", editingInvoiceId)
          .single();

        const { error: updateError } = await supabase
          .from("invoices")
          .update(
            await withInvoiceSafeId(
              supabase,
              {
                supplier_id: selectedSupplier.id,
                subtotal,
                tax_amount: taxAmount,
                discount_amount: discountAmount,
                total: grandTotal,
                paid_amount: actualPaidAmount,
                payment_method: paymentMethod,
                notes: notes || null,
              },
              needsSafe ? selectedSafeId : null
            )
          )
          .eq("id", editingInvoiceId);

        if (updateError) throw new Error(updateError.message);

        await supabase.from("invoice_items").delete().eq("invoice_id", editingInvoiceId);
        const purchaseEditErr = await insertInvoiceItems(
          supabase,
          mapCartToInvoiceItems(editingInvoiceId, cart, {
            kind: "purchase",
            invoiceDiscountAmount: discountAmount,
          })
        );
        if (purchaseEditErr.error) throw new Error(purchaseEditErr.error.message);

        await updateProductsBuyPrice(
          supabase,
          purchaseNetUnitCosts(cart, discountAmount)
        );

        await replaceStockImpact(
          supabase,
          (oldLines || []).map((l) => ({
            product_id: l.product_id,
            quantity: Number(l.quantity),
          })),
          cart.map((item) => ({
            product_id: item.product.id,
            quantity: item.quantity,
          })),
          1
        );

        if (oldInvoice?.supplier_id) {
          const oldRemaining = Number(oldInvoice.total) - Number(oldInvoice.paid_amount);
          if (oldRemaining > 0) {
            await adjustSupplierBalance(supabase, oldInvoice.supplier_id, -oldRemaining);
          }
        }

        if (selectedSupplier && remaining > 0) {
          await adjustSupplierBalance(supabase, selectedSupplier.id, remaining);
        }

        await syncInvoiceSafePayment(supabase, {
          invoiceId: editingInvoiceId,
          invoiceNumber: oldInvoice?.invoice_number || lastInvoice,
          invoiceType: "purchase",
          oldPaidAmount: Number(oldInvoice?.paid_amount ?? editingPaidAmount) || 0,
          oldSafeId: editingSafeId,
          newPaidAmount: actualPaidAmount,
          newSafeId: needsSafe ? selectedSafeId : null,
        });

        setEditingPaidAmount(actualPaidAmount);
        setEditingSafeId(needsSafe ? selectedSafeId : null);
        setShowInvoice(true);
        toastSuccess(
          `تم حفظ الفاتورة ${oldInvoice?.invoice_number || lastInvoice}`
        );
        void Promise.all([
          fetchProducts(),
          fetchSuppliers(),
          fetchSafes(),
        ]);
      } else {
        const purchaseItems = mapCartToInvoiceItems("pending", cart, {
          kind: "purchase",
          invoiceDiscountAmount: discountAmount,
        });
        const invoice = await createInvoiceOnlineOrQueue(supabase, {
          type: "purchase",
          items: purchaseItems,
          subtotal,
          taxAmount,
          discountAmount,
          total: grandTotal,
          paidAmount: actualPaidAmount,
          paymentMethod,
          supplierId: selectedSupplier.id,
          safeId: needsSafe ? selectedSafeId : null,
          notes: notes || null,
          createdAt: new Date().toISOString(),
        });

        await updateProductsBuyPrice(
          supabase,
          purchaseNetUnitCosts(cart, discountAmount)
        );

        setLastInvoice(invoice.invoice_number);
        setShowInvoice(true);
        toastSuccess(
          invoice.offline
            ? `تم الحفظ أوفلاين ${invoice.invoice_number} — سيُزامن عند عودة النت`
            : `تم حفظ الفاتورة ${invoice.invoice_number}`
        );
        void Promise.all([
          fetchProducts(),
          fetchSuppliers(),
          fetchSafes(),
        ]);
      }
    } catch (err: unknown) {
      toastError(formatRpcError(err, "تعذر حفظ فاتورة المشتريات"));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveQuote() {
    if (!selectedCustomer) {
      toastError("اختر عميلًا لعرض السعر.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        type: "quote" as const,
        customer_id: selectedCustomer.id,
        supplier_id: null,
        subtotal,
        tax_amount: taxAmount,
        discount_amount: discountAmount,
        total: grandTotal,
        notes: notes || null,
        valid_until: validUntil || null,
      };

      if (editingDocId) {
        const { error } = await supabase.from("documents").update(payload).eq("id", editingDocId);
        if (error) throw new Error(error.message);

        await supabase.from("document_items").delete().eq("document_id", editingDocId);
        const { error: itemsError } = await supabase.from("document_items").insert(
          cart.map((item) => ({
            document_id: editingDocId,
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount: item.discount,
            total: item.total,
          }))
        );
        if (itemsError) throw new Error(itemsError.message);

        setShowInvoice(true);
      } else {
        const documentNumber = await allocateDocumentNumber(supabase, "quote");
        const { data: doc, error } = await supabase
          .from("documents")
          .insert({
            ...payload,
            document_number: documentNumber,
            stage: "draft",
          })
          .select()
          .single();

        if (error || !doc) {
          throw new Error(error?.message || "تعذر حفظ عرض السعر");
        }

        const { error: itemsError } = await supabase.from("document_items").insert(
          cart.map((item) => ({
            document_id: doc.id,
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount: item.discount,
            total: item.total,
          }))
        );
        if (itemsError) throw new Error(itemsError.message);

        setLastInvoice(documentNumber);
        setShowInvoice(true);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "خطأ غير معروف";
      toastError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSavePurchaseOrder() {
    if (!selectedSupplier) {
      toastError("اختر المورد لطلب المشتريات.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        type: "purchase_order" as const,
        customer_id: null,
        supplier_id: selectedSupplier.id,
        subtotal,
        tax_amount: taxAmount,
        discount_amount: discountAmount,
        total: grandTotal,
        notes: notes || null,
        valid_until: null,
        expected_date: expectedDate || null,
      };

      if (editingDocId) {
        const { error } = await supabase.from("documents").update(payload).eq("id", editingDocId);
        if (error) throw new Error(error.message);

        await supabase.from("document_items").delete().eq("document_id", editingDocId);
        const { error: itemsError } = await supabase.from("document_items").insert(
          cart.map((item) => ({
            document_id: editingDocId,
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount: item.discount,
            total: item.total,
          }))
        );
        if (itemsError) throw new Error(itemsError.message);

        setShowInvoice(true);
      } else {
        const documentNumber = await allocateDocumentNumber(
          supabase,
          "purchase_order"
        );
        const { data: doc, error } = await supabase
          .from("documents")
          .insert({
            ...payload,
            document_number: documentNumber,
            stage: "draft",
          })
          .select()
          .single();

        if (error || !doc) {
          throw new Error(error?.message || "تعذر حفظ طلب المشتريات");
        }

        const { error: itemsError } = await supabase.from("document_items").insert(
          cart.map((item) => ({
            document_id: doc.id,
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount: item.discount,
            total: item.total,
          }))
        );
        if (itemsError) throw new Error(itemsError.message);

        setLastInvoice(documentNumber);
        setShowInvoice(true);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "خطأ غير معروف";
      toastError(message);
    } finally {
      setLoading(false);
    }
  }

  function clearForm() {
    discardPosDraft();
    setCart([]);
    setSelectedCustomer(null);
    setSelectedSupplier(null);
    setPaidAmount(0);
    setPaymentMethod("cash");
    setSelectedSafeId(pickDefaultSafeId(safes, "cash"));
    setEditingSafeId(null);
    setEditingPaidAmount(0);
    setDiscount(0);
    setDiscountType("amount");
    setNotes("");
    setValidUntil("");
    setExpectedDate("");
    setShowInvoice(false);
    setEditingInvoiceId(null);
    setEditingDocId(null);
    setLastInvoice("");
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("edit")) {
      router.replace(posUrl(mode));
    }
    searchRef.current?.focus();
  }

  async function resetForm() {
    if (
      cart.length > 0 &&
      !(await confirm({
        message: "مسح الأصناف الحالية وبدء فاتورة جديدة؟",
      }))
    ) {
      return;
    }
    clearForm();
  }

  const filteredProducts = products.filter((p) => smartSearchMatch(searchTerm, [p.name, p.sku]));

  const filteredCustomers = customers.filter((c) =>
    smartSearchMatch(partySearch, [c.name, c.phone])
  );

  const filteredSuppliers = suppliers.filter((s) =>
    smartSearchMatch(partySearch, [s.name, s.phone])
  );

  const partyResults = isPurchaseSide ? filteredSuppliers : filteredCustomers;

  useEffect(() => {
    if (!showPartyList) return;
    const el = document.getElementById(`party-option-${activePartyIndex}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activePartyIndex, showPartyList, partyResults.length]);

  function selectPartyByIndex(index: number) {
    const party = partyResults[index];
    if (!party) return;
    if (isPurchaseSide) {
      setSelectedSupplier(party as Supplier);
    } else {
      selectCustomer(party as Customer);
    }
    setShowPartyList(false);
    setPartySearch("");
    setActivePartyIndex(0);
  }

  function handlePartyKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setShowPartyList(false);
      return;
    }

    const hasSelection = isPurchaseSide ? !!selectedSupplier : !!selectedCustomer;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();

      if (hasSelection) {
        if (isPurchaseSide) setSelectedSupplier(null);
        else selectCustomer(null);
        setPartySearch("");
        setShowPartyList(true);
        setActivePartyIndex(0);
        return;
      }

      if (!showPartyList) {
        setShowPartyList(true);
        setActivePartyIndex(0);
        return;
      }

      if (partyResults.length === 0) return;

      setActivePartyIndex((prev) => {
        if (e.key === "ArrowDown") {
          return prev < partyResults.length - 1 ? prev + 1 : 0;
        }
        return prev > 0 ? prev - 1 : partyResults.length - 1;
      });
      return;
    }

    if (e.key === "Enter") {
      if (!showPartyList || hasSelection || partyResults.length === 0) return;
      e.preventDefault();
      const index =
        activePartyIndex >= 0 && activePartyIndex < partyResults.length
          ? activePartyIndex
          : 0;
      selectPartyByIndex(index);
    }
  }

  const listLinkHref = embedded
    ? mode === "quote"
      ? "/m/invoices?tab=quote"
      : mode === "purchase_order"
        ? "/m/invoices?tab=purchase_order"
        : mode === "purchase"
          ? "/m/invoices?tab=purchase"
          : "/m/invoices?tab=sale"
    : mode === "quote"
      ? "/sales?tab=quotes"
      : mode === "purchase_order"
        ? "/purchases?tab=orders"
        : mode === "purchase"
          ? "/purchases"
          : "/sales";

  const listLinkLabel =
    mode === "quote"
      ? "العروض"
      : mode === "purchase_order"
        ? "الطلبات"
        : mode === "purchase"
          ? "المشتريات"
          : "الفواتير";

  const emptyCartText =
    mode === "quote"
      ? "لا توجد أصناف في عرض السعر"
      : mode === "purchase_order"
        ? "لا توجد أصناف في طلب المشتريات"
        : mode === "purchase"
          ? "لا توجد أصناف في فاتورة المشتريات"
          : "السلة فارغة";

  const emptyCartTip =
    mode === "quote"
      ? "ابحث عن صنف بالاسم أو الكود واضغط Enter للإضافة"
      : mode === "purchase_order" || mode === "purchase"
        ? "اختر المورد أولاً، ثم أضف الأصناف من الجدول"
        : "امسح الباركود أو ابحث عن صنف واضغط Enter للإضافة";

  function submitButtonLabel() {
    if (loading) {
      return isEditing ? "جاري التحديث..." : "جاري الحفظ...";
    }
    if (mode === "quote") return editingDocId ? "تحديث عرض السعر" : "حفظ عرض السعر";
    if (mode === "purchase_order")
      return editingDocId ? "تحديث طلب المشتريات" : "حفظ طلب المشتريات";
    if (mode === "purchase")
      return editingInvoiceId ? "تحديث فاتورة المشتريات" : "حفظ فاتورة المشتريات";
    return editingInvoiceId ? "تحديث الفاتورة" : "حفظ الفاتورة";
  }

  function editBannerText() {
    if (mode === "quote") return `تعديل عرض السعر رقم ${lastInvoice}`;
    if (mode === "purchase_order") return `تعديل طلب المشتريات رقم ${lastInvoice}`;
    if (mode === "purchase") return `تعديل فاتورة مشتريات رقم ${lastInvoice}`;
    return `تعديل فاتورة رقم ${lastInvoice}`;
  }

  const ListLinkIcon =
    mode === "quote"
      ? FileText
      : mode === "purchase" || mode === "purchase_order"
        ? ShoppingCart
        : ReceiptText;

  return (
    <div className="flex flex-col gap-3">
      {isEditing && (
        <div className="sticky top-0 z-30 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 shadow-sm">
          <p className="text-sm font-bold text-amber-900">{editBannerText()}</p>
          <button
            type="button"
            onClick={() => resetForm()}
            className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
          >
            إلغاء التعديل
          </button>
        </div>
      )}

      <div
        className={`flex flex-col gap-4 lg:flex-row ${
          embedded
            ? "h-[calc(100dvh-12.5rem)] min-h-[28rem]"
            : isEditing
              ? "h-[calc(100vh-8.5rem)]"
              : "h-[calc(100vh-7rem)]"
        }`}
      >
      {editLoading && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#dcecff] border-t-[#1473e6]" />
        </div>
      )}

      {/* Right side - Products */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {!isEditing && (
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2.5">
            <button
              type="button"
              onClick={() => switchMode("sale")}
              className={`min-h-9 rounded-lg px-3 py-1.5 text-xs font-bold max-lg:min-h-11 max-lg:px-4 max-lg:py-2.5 max-lg:text-sm ${
                mode === "sale"
                  ? "bg-[#1473e6] text-white"
                  : "border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              فاتورة بيع
            </button>
            <button
              type="button"
              onClick={() => switchMode("quote")}
              className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold max-lg:min-h-11 max-lg:px-4 max-lg:py-2.5 max-lg:text-sm ${
                mode === "quote"
                  ? "bg-[#1473e6] text-white"
                  : "border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <FileText className="h-3.5 w-3.5 max-lg:h-4 max-lg:w-4" />
              عرض سعر
            </button>
            {canPurchase && (
              <>
            <button
              type="button"
              onClick={() => switchMode("purchase")}
              className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold max-lg:min-h-11 max-lg:px-4 max-lg:py-2.5 max-lg:text-sm ${
                mode === "purchase"
                  ? "bg-[#1473e6] text-white"
                  : "border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <ShoppingCart className="h-3.5 w-3.5 max-lg:h-4 max-lg:w-4" />
              فاتورة مشتريات
            </button>
            <button
              type="button"
              onClick={() => switchMode("purchase_order")}
              className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold max-lg:min-h-11 max-lg:px-4 max-lg:py-2.5 max-lg:text-sm ${
                mode === "purchase_order"
                  ? "bg-[#1473e6] text-white"
                  : "border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <ClipboardList className="h-3.5 w-3.5 max-lg:h-4 max-lg:w-4" />
              طلب مشتريات
            </button>
              </>
            )}
          </div>
        )}

        <div className="border-b border-gray-200 p-4">
          <div className="flex items-center gap-3">
          <input
            ref={searchRef}
            type="text"
            placeholder="مسح باركود أو بحث بالاسم / الكود..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setActiveProductIndex(0);
            }}
            onKeyDown={(e) => {
              const results = searchTerm ? filteredProducts : products.slice(0, 20);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveProductIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveProductIndex((prev) => (prev > 0 ? prev - 1 : prev));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const term = searchTerm.trim().toLowerCase();
                if (!term) {
                  // Empty box + Enter → jump back into the last line's qty
                  if (cart.length > 0) focusQtyInput(cart.length - 1);
                  return;
                }
                const exact = products.find(
                  (p) => p.sku.trim().toLowerCase() === term
                );
                if (!exact && results.length === 0) {
                  toastInfo(`لا يوجد صنف بالكود «${searchTerm.trim()}»`);
                  searchRef.current?.select();
                  return;
                }
                const product =
                  exact ||
                  (activeProductIndex >= 0 && activeProductIndex < results.length
                    ? results[activeProductIndex]
                    : results[0]);
                if (product) {
                  // Exact SKU = barcode scan → keep focus in the box for the next scan
                  addToCart(product, e.shiftKey, exact ? "search" : "qty");
                }
              }
            }}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200 max-lg:min-h-12 max-lg:text-base"
          />
          <Link
            href={listLinkHref}
            title={listLinkLabel}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#cfe2fa] bg-[#eef6ff] px-3 py-2.5 text-xs font-semibold text-[#1473e6] hover:bg-[#e0efff] max-lg:min-h-12 max-lg:px-4 max-lg:text-sm"
          >
            <ListLinkIcon className="h-4 w-4" />
            {listLinkLabel}
          </Link>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 px-0.5">
            <p className="text-[10px] text-gray-400">
              اختر الصنف بـ ↑↓ ثم Enter · اكتب الكمية ثم Enter للصنف اللي بعده · F2 بحث · Ctrl+Enter حفظ · السلة تُحفظ تلقائياً 24 ساعة
            </p>
            <button
              type="button"
              onClick={() => setShowShortcuts((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-[#d7e6f8] bg-[#f3f8ff] px-2 py-0.5 text-[10px] font-bold text-[#1473e6] hover:bg-[#eaf4ff]"
            >
              <Keyboard className="h-3 w-3" />
              اختصارات
            </button>
          </div>
          {showShortcuts && (
            <div className="mt-2 rounded-lg border border-[#e1e6ee] bg-[#f8fafc] px-3 py-2 text-[11px] text-[#3b4658]">
              <ul className="space-y-1">
                <li>
                  <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">
                    F2
                  </kbd>{" "}
                  تركيز البحث
                </li>
                <li>
                  <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">
                    ↑ ↓
                  </kbd>{" "}
                  التنقل بين الأصناف في القائمة
                </li>
                <li>
                  <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">
                    Enter
                  </kbd>{" "}
                  إضافة الصنف المحدد والانتقال لخانة الكمية
                </li>
                <li>
                  <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">
                    Enter
                  </kbd>{" "}
                  <span className="text-[10px] text-[#7a8699]">(من خانة الكمية)</span>{" "}
                  تثبيت الكمية والرجوع للبحث للصنف اللي بعده
                </li>
                <li>
                  <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">
                    Tab
                  </kbd>{" "}
                  من الكمية للسعر
                </li>
                <li>
                  <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">
                    Enter
                  </kbd>{" "}
                  <span className="text-[10px] text-[#7a8699]">(والبحث فاضي)</span>{" "}
                  رجوع لكمية آخر صنف
                </li>
                <li>
                  <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">
                    Ctrl+Delete
                  </kbd>{" "}
                  <span className="text-[10px] text-[#7a8699]">(من خانة الكمية)</span>{" "}
                  حذف السطر
                </li>
                <li>
                  <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">
                    Shift+Enter
                  </kbd>{" "}
                  إضافة عبوة كاملة
                </li>
                <li>
                  <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">
                    Ctrl+Enter
                  </kbd>{" "}
                  حفظ الفاتورة
                </li>
                <li>
                  <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">
                    Esc
                  </kbd>{" "}
                  إلغاء التأكيد / إغلاق
                </li>
              </ul>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm text-right">
            <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 text-gray-600 shadow-sm">
              <tr>
                <th className="px-4 py-3 text-right font-medium">الصنف</th>
                <th className="px-4 py-3 text-right font-medium">الكود</th>
                <th className="px-4 py-3 text-right font-medium">السعر</th>
                <th className="px-4 py-3 text-right font-medium">الكمية</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {(searchTerm ? filteredProducts : products.slice(0, 20)).map((product, index) => {
                const isOutOfStock = product.quantity <= 0;
                const isLowStock = product.quantity <= product.min_quantity;
                const isActive = index === activeProductIndex;
                const displayPrice = isPurchaseSide
                  ? purchasePriceBasis === "sell"
                    ? product.sell_price
                    : product.buy_price
                  : resolveSellPrice(
                      product,
                      selectedCustomer?.price_tier_id ?? null,
                      tierPricing
                    );
                const pack = Math.max(1, Number(product.pack_size) || 1);
                const canAdd = allowsOutOfStock || !isOutOfStock;
                return (
                  <tr
                    key={product.id}
                    onClick={() => addToCart(product)}
                    className={`group transition-colors ${
                      !canAdd
                        ? "cursor-not-allowed bg-gray-50 opacity-50"
                        : `cursor-pointer ${
                            isActive ? "bg-blue-100/70 font-semibold" : "hover:bg-blue-50"
                          }`
                    }`}
                  >
                    <td className="px-4 py-3 max-lg:py-4">
                      <div className="font-medium text-gray-900 max-lg:text-base">{product.name}</div>
                      {pack > 1 && (
                        <button
                          type="button"
                          disabled={!canAdd}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canAdd) addToCart(product, true);
                          }}
                          className="mt-1 rounded border border-[#cfe0f8] bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#1473e6] hover:bg-[#eef6ff] disabled:opacity-40 max-lg:mt-1.5 max-lg:min-h-9 max-lg:px-3 max-lg:py-1.5 max-lg:text-xs"
                          title={`إضافة تعبئة (${pack} ${product.unit || "قطعة"})`}
                        >
                          +تعبئة ×{pack}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500 max-lg:py-4 max-lg:text-sm">{product.sku}</td>
                    <td className="px-4 py-3 font-bold text-blue-700 max-lg:py-4 max-lg:text-base">
                      {formatCurrency(displayPrice)}
                      {pack > 1 && (
                        <div className="text-[10px] font-medium text-gray-400 max-lg:text-xs">
                          التعبئة {formatCurrency(displayPrice * pack)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 max-lg:py-4">
                      <span
                        className={stockQtyBadgeClass(
                          isOutOfStock ? "out" : isLowStock ? "low" : "ok"
                        )}
                      >
                        {product.quantity}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {(searchTerm ? filteredProducts : products.slice(0, 20)).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center">
                    {products.length === 0 ? (
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                        <Package className="h-9 w-9 text-[#c2c8d0]" />
                        <p className="text-sm font-semibold text-[#687386]">
                          لا توجد أصناف بعد
                        </p>
                        <p className="text-xs text-[#98a2b3]">
                          أضف أصناف من المخزون عشان تقدر تبدأ البيع من هنا.
                        </p>
                        <Link
                          href={embedded ? "/m/more/stock" : "/products"}
                          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-[#1473e6] px-4 py-2 text-xs font-bold text-white hover:bg-[#0b65d1]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          أضف أصناف
                        </Link>
                        {safes.length === 0 && (
                          <Link
                            href={embedded ? "/m/finance" : "/treasury"}
                            className="text-[11px] font-bold text-[#1473e6] hover:underline"
                          >
                            أو أضف خزنة أولاً من الخزينة
                          </Link>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-500">لا توجد أصناف مطابقة للبحث</span>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Left side - Cart */}
      <div className="flex w-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm max-lg:max-h-[min(72vh,720px)] lg:w-[26rem]">
        <div className="border-b border-gray-200 p-3">
          <div className="relative" ref={partyRef}>
            {isPurchaseSide ? (
              <>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    {selectedSupplier ? (
                      <div className="flex w-full items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                        <span className="truncate font-medium text-blue-900">
                          {selectedSupplier.name}
                        </span>
                        <button
                          type="button"
                          aria-label="إزالة المورد"
                          onClick={() => {
                            setSelectedSupplier(null);
                            setPartySearch("");
                          }}
                          className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-blue-600 hover:bg-blue-100 hover:text-blue-800 max-lg:min-h-10 max-lg:min-w-10"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <input
                        type="text"
                        placeholder="اختر مورد (مطلوب)..."
                        value={partySearch}
                        onChange={(e) => {
                          setPartySearch(e.target.value);
                          setShowPartyList(true);
                          setActivePartyIndex(0);
                        }}
                        onFocus={() => {
                          setShowPartyList(true);
                          setActivePartyIndex(0);
                        }}
                        onKeyDown={handlePartyKeyDown}
                        className="w-full rounded-lg border border-gray-300 py-2 pe-3 ps-3 text-sm focus:border-blue-500 focus:outline-none max-lg:min-h-12 max-lg:text-base"
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    title="إضافة مورد سريع"
                    onClick={() => {
                      setShowPartyList(false);
                      setShowQuickParty(true);
                    }}
                    className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-blue-700 transition-colors hover:bg-blue-100 max-lg:min-h-12 max-lg:min-w-12"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {selectedSupplier && (
                  <div className="mt-1.5 flex items-center justify-between px-1 text-xs text-gray-500">
                    <span>الرصيد الحالي للمورد:</span>
                    <span
                      className={`font-bold ${
                        selectedSupplier.balance > 0
                          ? "text-red-600"
                          : selectedSupplier.balance < 0
                            ? "text-green-600"
                            : "text-gray-500"
                      }`}
                    >
                      {selectedSupplier.balance > 0
                        ? `علينا ${formatCurrency(selectedSupplier.balance)}`
                        : selectedSupplier.balance < 0
                          ? `لنا ${formatCurrency(Math.abs(selectedSupplier.balance))}`
                          : "0.00"}
                    </span>
                  </div>
                )}
                {showPartyList && !selectedSupplier && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                    <div className="divide-y divide-gray-50">
                      {filteredSuppliers.map((s, index) => (
                        <button
                          key={s.id}
                          id={`party-option-${index}`}
                          type="button"
                          onClick={() => selectPartyByIndex(index)}
                          onMouseEnter={() => setActivePartyIndex(index)}
                          className={`flex w-full items-center justify-between px-4 py-2.5 text-right text-sm transition-colors ${
                            index === activePartyIndex
                              ? "bg-blue-100 font-semibold"
                              : "hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex flex-col text-right">
                            <span className="font-medium text-gray-900">{s.name}</span>
                            {s.phone && (
                              <span className="mt-0.5 text-xs text-gray-400">{s.phone}</span>
                            )}
                          </div>
                          <div className="text-left">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                s.balance > 0
                                  ? "bg-red-50 text-red-700"
                                  : s.balance < 0
                                    ? "bg-green-50 text-green-700"
                                    : "bg-gray-50 text-gray-500"
                              }`}
                            >
                              {s.balance > 0
                                ? `علينا: ${formatCurrency(s.balance)}`
                                : s.balance < 0
                                  ? `لنا: ${formatCurrency(Math.abs(s.balance))}`
                                  : "رصيد 0"}
                            </span>
                          </div>
                        </button>
                      ))}
                      {filteredSuppliers.length === 0 && (
                        <p className="px-4 py-2.5 text-center text-xs text-gray-400">
                          لا يوجد مورد بهذا الاسم
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPartyList(false);
                        setShowQuickParty(true);
                      }}
                      className="flex w-full items-center justify-center gap-1.5 border-t border-gray-100 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      <Plus className="h-4 w-4" />
                      إضافة مورد سريع
                      {partySearch.trim() ? ` «${partySearch.trim()}»` : ""}
                    </button>
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <span className="shrink-0 text-xs font-medium text-gray-500">
                    سعر الأساس:
                  </span>
                  <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
                    <button
                      type="button"
                      onClick={() => changePurchaseBasis("buy")}
                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                        purchasePriceBasis === "buy"
                          ? "bg-blue-600 text-white"
                          : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      سعر الشراء
                    </button>
                    <button
                      type="button"
                      onClick={() => changePurchaseBasis("sell")}
                      className={`border-r border-gray-200 px-3 py-1.5 text-xs font-semibold transition-colors ${
                        purchasePriceBasis === "sell"
                          ? "bg-blue-600 text-white"
                          : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      سعر البيع
                    </button>
                  </div>
                  {purchasePriceBasis === "sell" && (
                    <span className="text-[11px] text-amber-600">
                      حط الخصم على الفاتورة ليوزَّع كتكلفة على كل صنف
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    {selectedCustomer ? (
                      <div className="flex w-full items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                        <div className="min-w-0 truncate text-right">
                          <span className="font-medium text-blue-900">
                            {selectedCustomer.name}
                          </span>
                          {selectedCustomer.price_tier?.name &&
                            !selectedCustomer.price_tier.is_default && (
                              <span className="mr-2 text-xs text-blue-600">
                                ({selectedCustomer.price_tier.name})
                              </span>
                            )}
                        </div>
                        <button
                          type="button"
                          aria-label="إزالة العميل"
                          onClick={() => {
                            selectCustomer(null);
                            setPartySearch("");
                          }}
                          className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-blue-600 hover:bg-blue-100 hover:text-blue-800 max-lg:min-h-10 max-lg:min-w-10"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <input
                        type="text"
                        placeholder={
                          mode === "quote"
                            ? "اختر عميل (مطلوب)..."
                            : "اختر عميل (اختياري)..."
                        }
                        value={partySearch}
                        onChange={(e) => {
                          setPartySearch(e.target.value);
                          setShowPartyList(true);
                          setActivePartyIndex(0);
                        }}
                        onFocus={() => {
                          setShowPartyList(true);
                          setActivePartyIndex(0);
                        }}
                        onKeyDown={handlePartyKeyDown}
                        className="w-full rounded-lg border border-gray-300 py-2 pe-3 ps-3 text-sm focus:border-blue-500 focus:outline-none max-lg:min-h-12 max-lg:text-base"
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    title="إضافة عميل سريع"
                    onClick={() => {
                      setShowPartyList(false);
                      setShowQuickParty(true);
                    }}
                    className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-blue-700 transition-colors hover:bg-blue-100 max-lg:min-h-12 max-lg:min-w-12"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {selectedCustomer && (
                  <div className="mt-1.5 flex items-center justify-between px-1 text-xs text-gray-500">
                    <span>الرصيد الحالي للعميل:</span>
                    <span
                      className={`font-bold ${
                        selectedCustomer.balance > 0
                          ? "text-red-600"
                          : selectedCustomer.balance < 0
                            ? "text-green-600"
                            : "text-gray-500"
                      }`}
                    >
                      {selectedCustomer.balance > 0
                        ? `عليه ${formatCurrency(selectedCustomer.balance)}`
                        : selectedCustomer.balance < 0
                          ? `له ${formatCurrency(Math.abs(selectedCustomer.balance))}`
                          : "0.00"}
                    </span>
                  </div>
                )}
                {selectedCustomer &&
                  selectedCustomer.balance > 0 &&
                  !isDocMode &&
                  (paymentMethod === "credit" || remaining > 0) && (
                    <p className="mt-1 px-1 text-[11px] font-semibold text-amber-700">
                      عليه رصيد سابق: {formatCurrency(selectedCustomer.balance)}
                    </p>
                  )}
                {showPartyList && !selectedCustomer && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                    <div className="divide-y divide-gray-50">
                      {filteredCustomers.map((c, index) => (
                        <button
                          key={c.id}
                          id={`party-option-${index}`}
                          type="button"
                          onClick={() => selectPartyByIndex(index)}
                          onMouseEnter={() => setActivePartyIndex(index)}
                          className={`flex w-full items-center justify-between px-4 py-2.5 text-right text-sm transition-colors ${
                            index === activePartyIndex
                              ? "bg-blue-100 font-semibold"
                              : "hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex flex-col text-right">
                            <span className="font-medium text-gray-900">{c.name}</span>
                            {c.phone && (
                              <span className="mt-0.5 text-xs text-gray-400">{c.phone}</span>
                            )}
                          </div>
                          <div className="text-left">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                c.balance > 0
                                  ? "bg-red-50 text-red-700"
                                  : c.balance < 0
                                    ? "bg-green-50 text-green-700"
                                    : "bg-gray-50 text-gray-500"
                              }`}
                            >
                              {c.balance > 0
                                ? `عليه: ${formatCurrency(c.balance)}`
                                : c.balance < 0
                                  ? `له: ${formatCurrency(Math.abs(c.balance))}`
                                  : "رصيد 0"}
                            </span>
                          </div>
                        </button>
                      ))}
                      {filteredCustomers.length === 0 && (
                        <p className="px-4 py-2.5 text-center text-xs text-gray-400">
                          لا يوجد عميل بهذا الاسم
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPartyList(false);
                        setShowQuickParty(true);
                      }}
                      className="flex w-full items-center justify-center gap-1.5 border-t border-gray-100 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      <Plus className="h-4 w-4" />
                      إضافة عميل سريع
                      {partySearch.trim() ? ` «${partySearch.trim()}»` : ""}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="border-b border-gray-100 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              السلة ({cartItemCount})
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowHeldPanel((v) => !v)}
                className={`relative min-h-9 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors max-lg:min-h-11 max-lg:px-3 max-lg:text-sm ${
                  showHeldPanel || heldCarts.length > 0
                    ? "bg-amber-50 text-amber-800 hover:bg-amber-100"
                    : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                }`}
                title="السلال المحجوزة"
              >
                محجوز
                {heldCarts.length > 0 && (
                  <span className="mr-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] text-white max-lg:h-5 max-lg:min-w-5 max-lg:text-xs">
                    {heldCarts.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => holdCurrentCart()}
                disabled={cart.length === 0 || isEditing}
                className="inline-flex min-h-9 items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 max-lg:min-h-11 max-lg:px-3 max-lg:text-sm"
                title="حجز السلة الحالية"
              >
                <Pause className="h-3.5 w-3.5 max-lg:h-4 max-lg:w-4" />
                حجز
              </button>
            </div>
          </div>

          {showHeldPanel && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-amber-100 bg-amber-50/60 p-2">
              {heldCarts.length === 0 ? (
                <p className="px-1 py-2 text-center text-xs text-amber-800/70">
                  لا توجد سلال محجوزة لهذا الوضع
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {heldCarts.map((held) => (
                    <li
                      key={held.id}
                      className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => recallHeldCart(held)}
                        className="min-w-0 flex-1 text-right"
                        title="استرجاع"
                      >
                        <p className="truncate text-xs font-semibold text-gray-900">
                          {held.label}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          {heldCartItemCount(held)} صنف ·{" "}
                          {formatCurrency(heldCartTotal(held))} ·{" "}
                          {new Date(held.createdAt).toLocaleTimeString("ar-EG", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteHeldCart(held.id)}
                        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-red-500 hover:bg-red-50 max-lg:min-h-10 max-lg:min-w-10"
                        title="حذف الحجز"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-8 text-center">
              <ShoppingCart className="h-10 w-10 text-gray-300" strokeWidth={1.5} />
              <p className="text-sm font-semibold text-gray-600">{emptyCartText}</p>
              <p className="max-w-[220px] text-xs leading-relaxed text-gray-400">
                {emptyCartTip}
              </p>
              {heldCarts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHeldPanel(true)}
                  className="mt-1 text-xs font-semibold text-amber-700 underline-offset-2 hover:underline"
                >
                  عرض {heldCarts.length} سلة محجوزة
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {cart.map((item, index) => (
                <div key={item.product.id} className="py-2 first:pt-0 last:pb-0">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-right text-[13px] font-semibold leading-snug text-gray-900">
                      {item.product.name}
                      {Math.max(1, Number(item.product.pack_size) || 1) > 1 && (
                        <span className="mr-1 text-[10px] font-normal text-gray-500">
                          · تعبئة {Math.max(1, Number(item.product.pack_size) || 1)}
                        </span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeFromCart(index)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      title="حذف"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5" dir="rtl">
                      <div className="inline-flex h-8 items-center overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                        <button
                          type="button"
                          onClick={() => bumpCartQuantity(index, -1)}
                          disabled={item.quantity <= 1}
                          className="inline-flex h-8 w-8 items-center justify-center text-gray-600 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-35"
                          title="إنقاص"
                        >
                          <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </button>
                        <input
                          id={`qty-input-${index}`}
                          type="number"
                          min="1"
                          max={allowsOutOfStock ? undefined : item.product.quantity}
                          value={item.quantity === 0 ? "" : item.quantity}
                          onChange={(e) => {
                            const n = parseNumberInput(e.target.value);
                            updateCartItem(index, {
                              quantity: n === null ? 0 : n,
                            });
                          }}
                          onBlur={() => {
                            if (!item.quantity || item.quantity < 1) {
                              updateCartItem(index, { quantity: 1 });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitCartQuantity(index);
                              focusSearchInput();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              focusSearchInput();
                            } else if (e.key === "Tab" && !e.shiftKey) {
                              commitCartQuantity(index);
                              if (canEditPrices && focusPriceInput(index)) {
                                e.preventDefault();
                              }
                            } else if (e.key === "Delete" && e.ctrlKey) {
                              e.preventDefault();
                              removeFromCart(index);
                              focusSearchInput();
                            }
                          }}
                          className="h-8 w-10 border-x border-gray-200 bg-white text-center text-sm font-bold text-gray-900 tabular-nums focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400"
                          dir="ltr"
                        />
                        <button
                          type="button"
                          onClick={() => bumpCartQuantity(index, 1)}
                          disabled={
                            !allowsOutOfStock &&
                            item.quantity >= item.product.quantity
                          }
                          className="inline-flex h-8 w-8 items-center justify-center text-gray-600 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-35"
                          title="زيادة"
                        >
                          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </button>
                      </div>
                      <span className="text-[11px] text-gray-400">×</span>
                      {canEditPrices ? (
                        <input
                          id={`price-input-${index}`}
                          type="number"
                          step="0.01"
                          value={item.unit_price === 0 ? "" : item.unit_price}
                          onChange={(e) => {
                            const n = parseNumberInput(e.target.value);
                            updateCartItem(index, {
                              unit_price: n === null ? 0 : n,
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              focusSearchInput();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              focusSearchInput();
                            }
                          }}
                          className="h-8 w-[4.25rem] rounded-md border border-gray-200 px-1.5 text-center text-sm font-medium tabular-nums focus:border-blue-500 focus:outline-none"
                          dir="ltr"
                        />
                      ) : (
                        <span
                          className="inline-flex h-8 min-w-[4.25rem] items-center justify-center rounded-md border border-gray-100 bg-gray-50 px-1.5 text-center text-sm font-medium tabular-nums text-gray-600"
                          dir="ltr"
                        >
                          {formatCurrency(item.unit_price)}
                        </span>
                      )}
                    </div>

                    <div className="shrink-0 text-left text-sm font-bold tabular-nums text-blue-700">
                      {formatCurrency(item.total)}
                    </div>
                  </div>
                  {!allowsOutOfStock &&
                    item.quantity > item.product.quantity && (
                      <p className="mt-0.5 text-[11px] font-medium text-red-600">
                        المتاح: {item.product.quantity}
                      </p>
                    )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 space-y-1.5 border-t border-gray-200 bg-white p-2.5 max-lg:sticky max-lg:bottom-0 max-lg:z-20 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-lg:shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
          <div className="flex justify-between text-sm">
            <span className="text-gray-900">{formatCurrency(subtotal)}</span>
            <span className="text-gray-600">المجموع</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                max={discountType === "percent" ? 100 : undefined}
                value={discount === 0 ? "" : discount}
                onChange={(e) => {
                  const val = e.target.value === "" ? 0 : +e.target.value;
                  if (discountType === "percent" && val > 100) {
                    toastError("نسبة الخصم لا يمكن أن تتجاوز 100%");
                    setDiscount(100);
                    return;
                  }
                  setDiscount(discountType === "percent" ? Math.min(val, 100) : val);
                }}
                className="w-20 rounded border border-gray-300 px-2 py-1 text-center text-xs focus:border-blue-500 focus:outline-none max-lg:min-h-11 max-lg:w-24 max-lg:text-sm"
                dir="ltr"
              />
              <select
                value={discountType}
                onChange={(e) => {
                  const newType = e.target.value as "amount" | "percent";
                  setDiscountType(newType);
                  if (newType === "percent") {
                    setDiscount((prev) => Math.min(prev, 100));
                  }
                }}
                className="rounded border border-gray-300 bg-gray-50 px-1 py-1 text-xs focus:border-blue-500 focus:outline-none max-lg:min-h-11 max-lg:px-2 max-lg:text-sm"
              >
                <option value="amount">ج.م</option>
                <option value="percent">%</option>
              </select>
            </div>
            <span className="text-gray-600">الخصم</span>
          </div>
          {settings?.tax_enabled && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-900">{formatCurrency(taxAmount)}</span>
              <span className="text-gray-600">الضريبة ({taxRate}%)</span>
            </div>
          )}
          <div className="flex justify-between border-t border-gray-200 pt-2 text-base font-bold">
            <span className="text-blue-800">{formatCurrency(grandTotal)}</span>
            <span className="text-gray-900">الإجمالي</span>
          </div>

          {!isDocMode && (
            <>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMethod("cash");
                    setPaidAmount(grandTotal);
                  }}
                  className={paymentMethodChipClass("cash", paymentMethod === "cash")}
                >
                  نقدي
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMethod("credit");
                    setPaidAmount(0);
                  }}
                  className={paymentMethodChipClass("credit", paymentMethod === "credit")}
                >
                  آجل
                </button>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    value={paidAmount === 0 ? "" : paidAmount}
                    onChange={(e) => {
                      const val = e.target.value === "" ? 0 : +e.target.value;
                      if (paymentMethod === "credit") {
                        setPaidAmount(Math.min(Math.max(0, val), grandTotal));
                      } else {
                        setPaidAmount(Math.max(0, val));
                      }
                    }}
                    onFocus={(e) => e.target.select()}
                    className={`flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none max-lg:min-h-12 max-lg:text-base ${
                      paymentMethod === "cash" && isPurchaseSide
                        ? "bg-gray-50 text-gray-700"
                        : "bg-white"
                    }`}
                    dir="ltr"
                    placeholder={
                      paymentMethod === "cash"
                        ? cashAmountPlaceholder
                        : "المبلغ المدفوع مقدماً"
                    }
                    readOnly={paymentMethod === "cash" && isPurchaseSide}
                    title={
                      paymentMethod === "cash" && isPurchaseSide
                        ? "في المشتريات النقدية يُدفع إجمالي الفاتورة بعد الخصم"
                        : undefined
                    }
                  />
                  <span className="text-xs text-gray-600">
                    {paymentMethod === "cash" ? cashAmountLabel : "المدفوع مقدماً"}
                  </span>
                </div>
                {paymentMethod === "cash" && changeDue > 0 && (
                  <div className={`flex justify-between px-1 text-xs ${paymentAmountTextClass("success")}`}>
                    <span>الباقي للعميل:</span>
                    <span>{formatCurrency(changeDue)}</span>
                  </div>
                )}
                {paymentMethod === "credit" && remaining > 0 && (
                  <div className={`flex justify-between px-1 text-xs ${paymentAmountTextClass("warning")}`}>
                    <span>المتبقي (آجل):</span>
                    <span>{formatCurrency(remaining)}</span>
                  </div>
                )}
              </div>

              {needsSafe && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    الخزنة
                  </label>
                  <select
                    value={selectedSafeId}
                    onChange={(e) => setSelectedSafeId(e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none max-lg:min-h-12 max-lg:text-base ${
                      missingSafeSelection
                        ? "border-red-400 focus:border-red-500"
                        : "border-gray-300 focus:border-blue-500"
                    }`}
                    required
                  >
                    <option value="">اختر الخزنة</option>
                    {safes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {missingSafeSelection && (
                    <p className="mt-1 text-[11px] font-semibold text-red-600">
                      اختر الخزنة للمتابعة
                    </p>
                  )}
                  {safes.length === 0 && (
                    <p className="mt-1 text-[11px] text-red-600">
                      لا توجد خزائن —{" "}
                      <Link
                        href={embedded ? "/m/finance" : "/treasury"}
                        className="font-bold underline"
                      >
                        أضف خزنة من الخزينة
                      </Link>
                    </p>
                  )}
                  {selectedSafe && (
                    <p className="mt-1 px-0.5 text-[11px] text-gray-500">
                      رصيد الخزنة:{" "}
                      <span className="font-semibold text-gray-700">
                        {formatCurrency(Number(selectedSafe.balance) || 0)}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {mode === "quote" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">صالح حتى</label>
              <DateField
                value={validUntil}
                onChange={setValidUntil}
                inputClassName="border-gray-300 py-1.5 text-xs"
              />
            </div>
          )}

          {mode === "purchase_order" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                تاريخ التوريد المتوقع
              </label>
              <DateField
                value={expectedDate}
                onChange={setExpectedDate}
                inputClassName="border-gray-300 py-1.5 text-xs"
              />
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={cart.length === 0 || loading || missingSafeSelection}
            className="w-full rounded-lg bg-[#1473e6] py-3 text-sm font-bold text-white hover:bg-[#0b65d1] disabled:cursor-not-allowed disabled:opacity-50 max-lg:min-h-14 max-lg:py-4 max-lg:text-base"
          >
            {submitButtonLabel()}
          </button>
          {missingSafeSelection && cart.length > 0 && (
            <p className="-mt-1 text-center text-[11px] font-semibold text-red-600">
              اختر الخزنة للمتابعة
            </p>
          )}
        </div>
      </div>

      {showSaveConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => !loading && setShowSaveConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-save-confirm-title"
            className="max-h-[min(90vh,640px)] w-full max-w-md space-y-4 overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3
                id="pos-save-confirm-title"
                className="text-lg font-bold text-[#172033]"
              >
                تأكيد حفظ الفاتورة
              </h3>
              <p className="mt-1 text-sm text-[#687386]">
                راجع بيانات الدفع والخزنة قبل التأكيد
              </p>
            </div>
            {saleLoss?.hasLoss && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="space-y-0.5">
                  <p className="font-bold">تحذير: البيع أقل من التكلفة</p>
                  {saleLoss.belowCostLines.length > 0 && (
                    <p>
                      {saleLoss.belowCostLines.length} صنف تحت التكلفة
                      {saleLoss.belowCostLines[0]
                        ? ` (مثال: ${saleLoss.belowCostLines[0].name})`
                        : ""}
                    </p>
                  )}
                  {saleLoss.invoiceBelowCost && (
                    <p>
                      خسارة متوقعة{" "}
                      <span className="font-bold" dir="ltr">
                        {formatCurrency(saleLoss.invoiceLossAmount)}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            )}
            <dl className="space-y-2 rounded-xl border border-[#e5eaf1] bg-[#fafbfc] p-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[#687386]">الإجمالي</dt>
                <dd className="font-bold text-[#172033]">
                  {formatCurrency(grandTotal)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#687386]">طريقة الدفع</dt>
                <dd className="font-semibold">
                  {paymentMethod === "cash" ? "نقدي" : "آجل"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#687386]">
                  {paymentMethod === "cash"
                    ? cashAmountConfirmLabel
                    : "المدفوع مقدماً"}
                </dt>
                <dd className="font-bold" dir="ltr">
                  {formatCurrency(
                    paymentMethod === "cash" ? paidAmount : actualPaidAmount
                  )}
                </dd>
              </div>
              {paymentMethod === "cash" && !isPurchaseSide ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-[#687386]">الباقي للعميل</dt>
                  <dd className={paymentAmountTextClass("success")}>
                    {formatCurrency(changeDue)}
                  </dd>
                </div>
              ) : paymentMethod === "credit" ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-[#687386]">المتبقي (آجل)</dt>
                  <dd className={paymentAmountTextClass("warning")}>
                    {formatCurrency(remaining)}
                  </dd>
                </div>
              ) : null}
              {needsSafe && (
                <div className="flex justify-between gap-3 border-t border-[#e5eaf1] pt-2">
                  <dt className="text-[#687386]">الخزنة</dt>
                  <dd className="font-bold text-[#0f5bb8]">{selectedSafeName}</dd>
                </div>
              )}
              {needsSafe && (
                <div className="flex justify-between gap-3">
                  <dt className="text-[#687386]">
                    {mode === "purchase" ? "يخرج من الخزنة" : "يدخل الخزنة"}
                  </dt>
                  <dd className="font-bold" dir="ltr">
                    {formatCurrency(actualPaidAmount)}
                  </dd>
                </div>
              )}
            </dl>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowSaveConfirm(false)}
                disabled={loading}
                className="flex-1 rounded-lg border border-[#e5eaf1] py-2.5 text-sm font-semibold text-[#526176]"
              >
                رجوع
              </button>
              <button
                type="button"
                onClick={() => void executeConfirmedSave()}
                disabled={loading || missingSafeSelection}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#1473e6] py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {loading ? "جاري الحفظ..." : "تأكيد والحفظ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInvoice && mode === "sale" && isReceiptLayout(settings?.print_formats, "sale") && (
        <InvoicePreview
          invoiceNumber={lastInvoice}
          cart={cart}
          customer={selectedCustomer}
          subtotal={subtotal}
          discount={discountAmount}
          taxAmount={taxAmount}
          total={grandTotal}
          paid={
            paymentMethod === "cash" ? paidAmount : actualPaidAmount
          }
          paymentMethod={paymentMethod}
          kind="invoice"
          cashierName={profile?.full_name || "الكاشير"}
          settings={settings}
          onClose={clearForm}
        />
      )}

      {showInvoice && mode === "sale" && !isReceiptLayout(settings?.print_formats, "sale") && (
        <DocumentPrintPreview
          kind="sale"
          documentNumber={lastInvoice}
          items={cart.map((item) => ({
            name: item.product.name,
            sku: item.product.sku,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount: item.discount,
            total: item.total,
          }))}
          partyName={selectedCustomer?.name}
          partyPhone={selectedCustomer?.phone}
          partyLabel="العميل"
          subtotal={subtotal}
          discount={discountAmount}
          taxAmount={taxAmount}
          total={grandTotal}
          paid={paymentMethod === "cash" ? paidAmount : actualPaidAmount}
          paymentMethod={paymentMethod}
          cashierName={profile?.full_name || "الكاشير"}
          notes={notes || undefined}
          settings={settings}
          onClose={clearForm}
          autoPrint
        />
      )}

      {showInvoice && mode === "quote" && isReceiptLayout(settings?.print_formats, "quote") && (
        <InvoicePreview
          invoiceNumber={lastInvoice}
          cart={cart}
          customer={selectedCustomer}
          subtotal={subtotal}
          discount={discountAmount}
          taxAmount={taxAmount}
          total={grandTotal}
          paid={0}
          paymentMethod="cash"
          kind="quote"
          cashierName={profile?.full_name || "الكاشير"}
          settings={settings}
          onClose={clearForm}
        />
      )}

      {showInvoice && mode === "quote" && !isReceiptLayout(settings?.print_formats, "quote") && (
        <DocumentPrintPreview
          kind="quote"
          documentNumber={lastInvoice}
          items={cart.map((item) => ({
            name: item.product.name,
            sku: item.product.sku,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount: item.discount,
            total: item.total,
          }))}
          partyName={selectedCustomer?.name}
          partyPhone={selectedCustomer?.phone}
          partyLabel="العميل"
          subtotal={subtotal}
          discount={discountAmount}
          taxAmount={taxAmount}
          total={grandTotal}
          notes={notes || undefined}
          stage="draft"
          cashierName={profile?.full_name || "الكاشير"}
          settings={settings}
          onClose={clearForm}
        />
      )}

      {showInvoice && (mode === "purchase" || mode === "purchase_order") && (
        <DocumentPrintPreview
          kind={mode}
          documentNumber={lastInvoice}
          items={cart.map((item) => ({
            name: item.product.name,
            sku: item.product.sku,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount: item.discount,
            total: item.total,
          }))}
          partyName={selectedSupplier?.name}
          partyPhone={selectedSupplier?.phone}
          partyLabel="المورد"
          subtotal={subtotal}
          discount={discountAmount}
          taxAmount={taxAmount}
          total={grandTotal}
          paid={mode === "purchase" ? actualPaidAmount : undefined}
          paymentMethod={mode === "purchase" ? paymentMethod : undefined}
          notes={notes || undefined}
          stage={mode === "purchase_order" ? "draft" : undefined}
          cashierName={profile?.full_name || "الكاشير"}
          settings={settings}
          onClose={clearForm}
        />
      )}

      {showQuickParty && (
        <QuickPartyForm
          kind={isPurchaseSide ? "supplier" : "customer"}
          initialName={partySearch}
          onClose={() => setShowQuickParty(false)}
          onCreated={(party) => {
            setShowQuickParty(false);
            setPartySearch("");
            setShowPartyList(false);
            if (isPurchaseSide) {
              const supplier = party as Supplier;
              setSuppliers((prev) =>
                [...prev, supplier].sort((a, b) => a.name.localeCompare(b.name, "ar"))
              );
              setSelectedSupplier(supplier);
            } else {
              const customer = party as Customer;
              setCustomers((prev) =>
                [...prev, customer].sort((a, b) => a.name.localeCompare(b.name, "ar"))
              );
              selectCustomer(customer);
            }
          }}
        />
      )}
      </div>
    </div>
  );
}
