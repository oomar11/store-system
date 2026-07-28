"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import {
  DOCUMENT_STAGE_COLORS,
  DOCUMENT_STAGE_LABELS,
  formatCurrency,
  formatDateRelative,
  smartSearchMatch,
  parseNumberInput,
} from "@/lib/utils";
import { allocateDocumentNumber } from "@/lib/document-numbers";
import { createInvoiceOnlineOrQueue, getSnapshot, isBrowserOnline, withTimeout } from "@/lib/offline";
import { mapCartToInvoiceItems, insertInvoiceItems } from "@/lib/invoice-cost";
import { useSort } from "@/hooks/useSort";
import { SortableHeader } from "@/components/ui/SortableHeader";
import { DateField } from "@/components/ui/DateField";
import type {
  CommercialDocument,
  Customer,
  DocumentStage,
  DocumentType,
  Product,
  Settings,
  Supplier,
} from "@/types";
import { ArrowRightLeft, Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { TableRowActions, type RowAction } from "@/components/ui/TableRowActions";
import {
  useRowContextMenu,
  toContextMenuItems,
  type ContextMenuItem,
} from "@/components/ui/ContextMenu";
import { copyAsLabel, posCopyUrl } from "@/lib/pos-copy";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { PrintReportPreview } from "@/components/print/PrintReportPreview";
import { DocumentPrintPreview } from "@/components/print/DocumentPrintPreview";
import { PrintListButton } from "@/components/print/PrintListButton";
import { documentListColumns } from "@/components/print/report-columns";
import {
  DOCUMENTS_SETUP_SQL,
  SUPABASE_SQL_EDITOR_URL,
} from "@/lib/documents-setup";

type LineItem = {
  product: Product;
  quantity: number;
  unit_price: number;
  total: number;
};

const STAGE_FLOW: DocumentStage[] = [
  "draft",
  "sent",
  "approved",
  "rejected",
  "converted",
  "cancelled",
];

const NEXT_STAGES: Partial<Record<DocumentStage, DocumentStage[]>> = {
  draft: ["sent", "cancelled"],
  sent: ["approved", "rejected", "cancelled"],
  approved: ["converted", "cancelled"],
  rejected: ["draft", "cancelled"],
  cancelled: ["draft"],
};

type DocumentsPanelProps = {
  /** Fixed document type when embedded in purchases/sales. Omit for both tabs. */
  fixedType?: DocumentType;
  /** Hide page-level title/CTA chrome when parent already provides a header. */
  embedded?: boolean;
  /** Increment to open the create modal (e.g. from parent CTA). */
  createTrigger?: number;
  /** Called after successful convert-to-invoice. */
  onConverted?: (invoiceType: "purchase" | "sale", invoiceNumber: string) => void;
};

export function DocumentsPanel({
  fixedType,
  embedded = false,
  createTrigger = 0,
  onConverted,
}: DocumentsPanelProps) {
  const router = useRouter();
  const { profile } = useAuth();
  const { openMenu, menu: contextMenu } = useRowContextMenu();
  const supabase = createClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const [tab, setTab] = useState<DocumentType>(fixedType || "purchase_order");
  const [documents, setDocuments] = useState<CommercialDocument[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [mode, setMode] = useState<"create" | "edit" | "view" | null>(null);
  const [activeDoc, setActiveDoc] = useState<CommercialDocument | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customer_id: "",
    supplier_id: "",
    notes: "",
    valid_until: "",
    expected_date: "",
    stage: "draft" as DocumentStage,
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missingTable, setMissingTable] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showListPrint, setShowListPrint] = useState(false);
  const [docPrint, setDocPrint] = useState<{
    doc: CommercialDocument;
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
  const lastCreateTrigger = useRef(0);

  const activeType = fixedType || tab;

  async function fetchAll() {
    setLoading(true);
    setLoadError(null);

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
      if (snap?.products?.length) {
        setProducts(snap.products as unknown as Product[]);
      }
      if (snap?.settings) setSettings(snap.settings as unknown as Settings);
      setDocuments([]);
      setLoadError("الوثائق تحتاج إنترنت للعرض الكامل. البيانات الأساسية متاحة أوفلاين.");
      setLoading(false);
      return;
    }

    try {
      const [docRes, custRes, supRes, prodRes, settingsRes] = await withTimeout(
        Promise.all([
          supabase
            .from("documents")
            .select(
              "*, customer:customers(name), supplier:suppliers(name), converted_invoice:invoices!converted_invoice_id(id, invoice_number)"
            )
            .eq("type", activeType)
            .order("created_at", { ascending: false }),
          supabase.from("customers").select("*").eq("is_active", true).order("name"),
          supabase.from("suppliers").select("*").eq("is_active", true).order("name"),
          supabase.from("products").select("*").eq("is_active", true).order("name"),
          supabase.from("settings").select("*").limit(1).maybeSingle(),
        ]),
        5000
      );
      if (docRes.error) {
        const missing =
          docRes.error.message.includes("does not exist") ||
          docRes.error.code === "42P01" ||
          docRes.error.code === "PGRST205" ||
          /Could not find the table/i.test(docRes.error.message);
        setMissingTable(missing);
        setLoadError(
          missing
            ? "جدول الوثائق غير موجود في قاعدة البيانات — لازم تشغيل SQL مرة واحدة."
            : docRes.error.message
        );
        setDocuments([]);
      } else if (docRes.data) {
        setMissingTable(false);
        setDocuments(docRes.data);
      }
      if (custRes.data) setCustomers(custRes.data);
      if (supRes.data) setSuppliers(supRes.data);
      if (prodRes.data) setProducts(prodRes.data);
      if (settingsRes.data) setSettings(settingsRes.data);
    } catch {
      setLoadError("تعذر تحميل الوثائق — تحقق من الاتصال وحاول مرة أخرى.");
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload on type change
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType]);

  useEffect(() => {
    if (createTrigger > lastCreateTrigger.current) {
      lastCreateTrigger.current = createTrigger;
      openCreate();
    }
    // openCreate is stable enough for this trigger-only effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createTrigger]);

  const filtered = documents.filter((doc) => {
    const matchesSearch = smartSearchMatch(searchTerm, [
      doc.document_number,
      doc.customer?.name,
      doc.supplier?.name,
    ]);
    const matchesStage = !stageFilter || doc.stage === stageFilter;
    return matchesSearch && matchesStage;
  });
  const { items: sorted, sortConfig, requestSort } = useSort(filtered);
  const listTotal = sorted.reduce((sum, doc) => sum + Number(doc.total), 0);
  const calculatedTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0),
    [items]
  );

  async function printDocument(doc: CommercialDocument) {
    const [{ data: lines }, partyRes] = await Promise.all([
      supabase
        .from("document_items")
        .select("*, product:products(name, sku)")
        .eq("document_id", doc.id),
      activeType === "purchase_order" && doc.supplier_id
        ? supabase
            .from("suppliers")
            .select("name, phone")
            .eq("id", doc.supplier_id)
            .single()
        : doc.customer_id
          ? supabase
              .from("customers")
              .select("name, phone")
              .eq("id", doc.customer_id)
              .single()
          : Promise.resolve({ data: null as { name: string; phone?: string } | null }),
    ]);

    setDocPrint({
      doc,
      partyName:
        partyRes.data?.name ||
        doc.supplier?.name ||
        doc.customer?.name ||
        undefined,
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

  function openCreate() {
    if (activeType === "quote") {
      router.push("/pos?mode=quote");
      return;
    }
    if (activeType === "purchase_order") {
      router.push("/pos?mode=purchase_order");
      return;
    }
    setActiveDoc(null);
    setForm({
      customer_id: "",
      supplier_id: "",
      notes: "",
      valid_until: "",
      expected_date: "",
      stage: "draft",
    });
    setItems([]);
    setMode("create");
  }

  async function openDoc(doc: CommercialDocument, nextMode: "view" | "edit") {
    if (activeType === "quote" && nextMode === "edit") {
      router.push(`/pos?mode=quote&edit=${doc.id}`);
      return;
    }
    if (activeType === "purchase_order" && nextMode === "edit") {
      router.push(`/pos?mode=purchase_order&edit=${doc.id}`);
      return;
    }
    const { data: lines } = await supabase
      .from("document_items")
      .select("*, product:products(*)")
      .eq("document_id", doc.id);

    setActiveDoc(doc);
    setForm({
      customer_id: doc.customer_id || "",
      supplier_id: doc.supplier_id || "",
      notes: doc.notes || "",
      valid_until: doc.valid_until || "",
      expected_date: doc.expected_date || "",
      stage: doc.stage,
    });
    setItems(
      lines?.map((line) => ({
        product: line.product,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
        total: Number(line.total),
      })) || []
    );
    setMode(nextMode);
  }

  function addProduct(product: Product) {
    const price = activeType === "purchase_order" ? product.buy_price : product.sell_price;
    const existing = items.findIndex((item) => item.product.id === product.id);
    if (existing !== -1) {
      setItems(
        items.map((item, i) =>
          i === existing
            ? {
                ...item,
                quantity: item.quantity + 1,
                total: (item.quantity + 1) * item.unit_price,
              }
            : item
        )
      );
    } else {
      setItems([
        ...items,
        { product, quantity: 1, unit_price: price, total: price },
      ]);
    }
    setProductSearch("");
  }

  function updateLine(index: number, quantity: number, unit_price: number) {
    setItems(
      items.map((item, i) =>
        i === index
          ? { ...item, quantity, unit_price, total: quantity * unit_price }
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
    if (activeType === "purchase_order" && !form.supplier_id) {
      toastError("اختر المورد لطلب المشتريات.");
      return;
    }
    if (activeType === "quote" && !form.customer_id) {
      toastError("اختر العميل لعرض السعر.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        type: activeType,
        stage: form.stage,
        customer_id: activeType === "quote" ? form.customer_id : null,
        supplier_id: activeType === "purchase_order" ? form.supplier_id : null,
        subtotal: calculatedTotal,
        total: calculatedTotal,
        notes: form.notes || null,
        valid_until: activeType === "quote" && form.valid_until ? form.valid_until : null,
        expected_date:
          activeType === "purchase_order" && form.expected_date ? form.expected_date : null,
      };

      let documentId = activeDoc?.id;

      if (mode === "create") {
        const { data: doc, error } = await supabase
          .from("documents")
          .insert({
            ...payload,
            document_number: await allocateDocumentNumber(supabase, activeType),
          })
          .select()
          .single();
        if (error || !doc) throw new Error(error?.message || "فشل الإنشاء");
        documentId = doc.id;
      } else if (activeDoc) {
        const { error } = await supabase
          .from("documents")
          .update(payload)
          .eq("id", activeDoc.id);
        if (error) throw new Error(error.message);
        await supabase.from("document_items").delete().eq("document_id", activeDoc.id);
      }

      if (!documentId) throw new Error("معرف الوثيقة مفقود");

      await supabase.from("document_items").insert(
        items.map((item) => ({
          document_id: documentId,
          product_id: item.product.id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.quantity * item.unit_price,
        }))
      );

      setMode(null);
      await fetchAll();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "خطأ غير معروف";
      toastError("تعذر الحفظ: " + message);
    } finally {
      setSaving(false);
    }
  }

  async function changeStage(doc: CommercialDocument, stage: DocumentStage) {
    if (stage === "converted") {
      await convertDocument(doc);
      return;
    }
    const { error } = await supabase.from("documents").update({ stage }).eq("id", doc.id);
    if (error) {
      toastError("تعذر تحديث المرحلة: " + error.message);
      return;
    }
    await fetchAll();
  }

  async function convertDocument(doc: CommercialDocument) {
    if (doc.stage === "converted") {
      toastError("هذه الوثيقة محوّلة مسبقاً.");
      return;
    }
    if (doc.stage !== "approved" && doc.stage !== "sent") {
      if (
        !(await confirm({
          message: "الوثيقة ليست معتمدة بعد. هل تريد التحويل لفاتورة الآن؟",
        }))
      )
        return;
    }

    const { data: lines } = await supabase
      .from("document_items")
      .select("*, product:products(*)")
      .eq("document_id", doc.id);

    if (!lines || lines.length === 0) {
      toastError("لا توجد بنود للتحويل.");
      return;
    }

    const total = lines.reduce((sum, l) => sum + Number(l.total), 0);

    try {
      if (doc.type === "purchase_order") {
        if (!doc.supplier_id) {
          toastError("طلب المشتريات بدون مورد.");
          return;
        }
        const mapped = mapCartToInvoiceItems(
          "pending",
          lines.map((line) => ({
            product: (line.product as Product) || {
              id: line.product_id,
              buy_price: 0,
            },
            quantity: Number(line.quantity),
            unit_price: Number(line.unit_price),
            total: Number(line.total),
          })),
          { kind: "purchase" }
        );
        const invoice = await createInvoiceOnlineOrQueue(supabase, {
          type: "purchase",
          items: mapped,
          subtotal: total,
          total,
          paidAmount: 0,
          paymentMethod: "credit",
          supplierId: doc.supplier_id,
          notes: `محوّل من طلب مشتريات ${doc.document_number}`,
          createdAt: new Date().toISOString(),
        });

        if (invoice.offline) {
          toastSuccess(
            `تم حفظ الفاتورة أوفلاين ${invoice.invoice_number} — اربط الوثيقة بعد المزامنة`
          );
          await fetchAll();
          return;
        }

        await supabase
          .from("documents")
          .update({ stage: "converted", converted_invoice_id: invoice.id })
          .eq("id", doc.id);

        toastSuccess(`تم التحويل لفاتورة مشتريات ${invoice.invoice_number}`);
        onConverted?.("purchase", invoice.invoice_number);
      } else {
        if (!doc.customer_id) {
          toastError("عرض السعر بدون عميل.");
          return;
        }
        const mapped = mapCartToInvoiceItems(
          "pending",
          lines.map((line) => ({
            product: (line.product as Product) || {
              id: line.product_id,
              buy_price: 0,
            },
            quantity: Number(line.quantity),
            unit_price: Number(line.unit_price),
            total: Number(line.total),
          })),
          { kind: "sale" }
        );
        const invoice = await createInvoiceOnlineOrQueue(supabase, {
          type: "sale",
          items: mapped,
          subtotal: total,
          total,
          paidAmount: 0,
          paymentMethod: "credit",
          customerId: doc.customer_id,
          notes: `محوّل من عرض سعر ${doc.document_number}`,
          createdAt: new Date().toISOString(),
        });

        if (invoice.offline) {
          toastSuccess(
            `تم حفظ الفاتورة أوفلاين ${invoice.invoice_number} — اربط الوثيقة بعد المزامنة`
          );
          await fetchAll();
          return;
        }

        await supabase
          .from("documents")
          .update({ stage: "converted", converted_invoice_id: invoice.id })
          .eq("id", doc.id);

        toastSuccess(`تم التحويل لفاتورة مبيعات ${invoice.invoice_number}`);
        onConverted?.("sale", invoice.invoice_number);
      }

      await fetchAll();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "خطأ غير معروف";
      toastError("تعذر التحويل: " + message);
    }
  }

  async function copyDocumentNumber(documentNumber: string) {
    try {
      await navigator.clipboard.writeText(documentNumber);
      toastSuccess(`تم نسخ ${documentNumber}`);
    } catch {
      toastError("تعذر نسخ رقم الوثيقة");
    }
  }

  async function handleDelete(doc: CommercialDocument) {
    if (doc.stage === "converted") {
      toastError("لا يمكن حذف وثيقة محوّلة لفاتورة.");
      return;
    }
    if (
      !(await confirm({
        message: `حذف ${doc.document_number}؟`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    )
      return;
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) {
      toastError("تعذر الحذف: " + error.message);
      return;
    }
    await fetchAll();
  }

  function documentRowActions(doc: CommercialDocument): RowAction[] {
    return [
      {
        label: "طباعة",
        tone: "print",
        icon: "printer",
        onClick: () => void printDocument(doc),
      },
      {
        label: "نسخ الرقم",
        tone: "copy",
        icon: "copy",
        onClick: () => void copyDocumentNumber(doc.document_number),
      },
      {
        label: "عرض",
        tone: "view",
        icon: "eye",
        onClick: () => void openDoc(doc, "view"),
      },
      ...(doc.stage !== "converted"
        ? [
            {
              label: "تعديل",
              tone: "edit" as const,
              icon: "pencil" as const,
              onClick: () => void openDoc(doc, "edit"),
            },
            {
              label: "حذف",
              tone: "delete" as const,
              icon: "trash" as const,
              onClick: () => void handleDelete(doc),
            },
          ]
        : []),
    ];
  }

  function documentContextItems(doc: CommercialDocument): ContextMenuItem[] {
    const isPo = doc.type === "purchase_order";
    const items: ContextMenuItem[] = [
      ...toContextMenuItems(documentRowActions(doc)),
    ];
    if (doc.stage !== "converted" && doc.stage !== "cancelled") {
      items.push({
        label: "تحويل لفاتورة",
        tone: "edit",
        icon: "pencil",
        onClick: () => void convertDocument(doc),
      });
    }
    items.push(
      { kind: "separator" },
      {
        label: copyAsLabel(isPo ? "purchase_order" : "quote"),
        tone: "copy",
        icon: "copy",
        onClick: () =>
          router.push(
            posCopyUrl(doc.id, isPo ? "purchase_order" : "quote", {
              sourceKind: "document",
            })
          ),
      },
      {
        label: copyAsLabel(isPo ? "purchase" : "sale"),
        tone: "copy",
        icon: "copy",
        onClick: () =>
          router.push(
            posCopyUrl(doc.id, isPo ? "purchase" : "sale", {
              sourceKind: "document",
            })
          ),
      },
      {
        label: copyAsLabel(isPo ? "sale" : "purchase"),
        tone: "copy",
        icon: "copy",
        onClick: () =>
          router.push(
            posCopyUrl(doc.id, isPo ? "sale" : "purchase", {
              sourceKind: "document",
            })
          ),
      }
    );
    return items;
  }

  const readOnly = mode === "view";
  const title = activeType === "purchase_order" ? "طلبات المشتريات" : "عروض الأسعار";
  const createLabel =
    activeType === "purchase_order" ? "طلب مشتريات جديد" : "عرض سعر جديد";

  return (
    <div>
      {!embedded && (
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-1 text-xs font-semibold text-[#1473e6]">الوثائق التجارية</p>
            <h1 className="text-2xl font-bold text-[#172033]">{title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <PrintListButton
              onClick={() => setShowListPrint(true)}
              rowCount={sorted.length}
              label="طباعة القائمة"
            />
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#1473e6] px-4 py-2 text-sm font-bold text-white shadow-[0_7px_18px_rgba(20,115,230,0.18)] hover:bg-[#0b65d1]"
            >
              <Plus className="h-4 w-4" />
              {createLabel}
            </button>
          </div>
        </div>
      )}

      {embedded && (
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <PrintListButton
            onClick={() => setShowListPrint(true)}
            rowCount={sorted.length}
            label="طباعة القائمة"
          />
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#1473e6] px-4 py-2 text-sm font-bold text-white shadow-[0_7px_18px_rgba(20,115,230,0.18)] hover:bg-[#0b65d1]"
          >
            <Plus className="h-4 w-4" />
            {createLabel}
          </button>
        </div>
      )}

      {!fixedType && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setTab("purchase_order")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "purchase_order"
                ? "bg-[#1473e6] text-white"
                : "border border-[#e1e6ee] text-[#687386] hover:bg-[#f7f9fc]"
            }`}
          >
            طلب مشتريات
          </button>
          <button
            onClick={() => setTab("quote")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "quote"
                ? "bg-[#1473e6] text-white"
                : "border border-[#e1e6ee] text-[#687386] hover:bg-[#f7f9fc]"
            }`}
          >
            عرض سعر
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="بحث بالرقم أو الاسم..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full max-w-md rounded-lg border border-[#e1e6ee] px-4 py-2 text-sm focus:border-[#9ac7fa] focus:outline-none"
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-lg border border-[#e1e6ee] px-3 py-2 text-sm"
        >
          <option value="">كل المراحل</option>
          {STAGE_FLOW.map((stage) => (
            <option key={stage} value={stage}>
              {DOCUMENT_STAGE_LABELS[stage]}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {STAGE_FLOW.map((stage) => (
          <span
            key={stage}
            className={`rounded-full px-2.5 py-1 font-semibold ${DOCUMENT_STAGE_COLORS[stage]}`}
          >
            {DOCUMENT_STAGE_LABELS[stage]}
          </span>
        ))}
      </div>

      {loadError && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950">
          <p className="font-bold">{loadError}</p>
          {missingTable ? (
            <div className="mt-3 space-y-3">
              <ol className="list-decimal space-y-1 pr-5 text-amber-900">
                <li>افتح SQL Editor في Supabase</li>
                <li>الصق الـ SQL ثم اضغط Run</li>
                <li>ارجع هنا واضغط تحديث</li>
              </ol>
              <div className="flex flex-wrap gap-2">
                <a
                  href={SUPABASE_SQL_EDITOR_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-[#1473e6] px-3 py-2 text-xs font-bold text-white hover:bg-[#0b65d1]"
                >
                  فتح SQL Editor
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(DOCUMENTS_SETUP_SQL);
                      setSqlCopied(true);
                      setTimeout(() => setSqlCopied(false), 2500);
                    } catch {
                      toastError("انسخ الـ SQL من ملف supabase/FIX_NOW.sql");
                    }
                  }}
                  className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                >
                  {sqlCopied ? "تم النسخ ✓" : "نسخ SQL"}
                </button>
                <button
                  type="button"
                  onClick={() => void fetchAll()}
                  className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                >
                  تحديث
                </button>
              </div>
              <details className="rounded-lg border border-amber-200 bg-white/70 p-2">
                <summary className="cursor-pointer text-xs font-semibold">عرض الـ SQL</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-[#344054]" dir="ltr">
                  {DOCUMENTS_SETUP_SQL}
                </pre>
              </details>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void fetchAll()}
              className="mt-3 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold"
            >
              إعادة المحاولة
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#dcecff] border-t-[#1473e6]" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#e9edf4] bg-white shadow-sm">
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-[#f7f9fc] text-[#687386]">
                <tr>
                  <SortableHeader
                    label="الرقم"
                    field="document_number"
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <SortableHeader
                    label={activeType === "purchase_order" ? "المورد" : "العميل"}
                    field={
                      activeType === "purchase_order" ? "supplier.name" : "customer.name"
                    }
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <SortableHeader
                    label="المرحلة"
                    field="stage"
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
                    label="الإجمالي"
                    field="total"
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <th className="px-4 py-3 text-right font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef1f6]">
                {sorted.map((doc) => (
                  <tr
                    key={doc.id}
                    className="hover:bg-[#f7f9fc]"
                    onContextMenu={(e) => openMenu(e, documentContextItems(doc))}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{doc.document_number}</td>
                    <td className="px-4 py-3">
                      {activeType === "purchase_order"
                        ? doc.supplier?.name || "-"
                        : doc.customer?.name || "-"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ${DOCUMENT_STAGE_COLORS[doc.stage]}`}
                        >
                          {DOCUMENT_STAGE_LABELS[doc.stage]}
                        </span>
                        {doc.stage === "converted" &&
                          doc.converted_invoice?.invoice_number && (
                            <span className="text-[11px] font-medium text-indigo-700">
                              فاتورة: {doc.converted_invoice.invoice_number}
                            </span>
                          )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#687386]">
                      {formatDateRelative(doc.created_at)}
                    </td>
                    <td className="px-4 py-3 font-semibold">{formatCurrency(doc.total)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <TableRowActions actions={documentRowActions(doc)} />
                        {doc.stage !== "converted" && doc.stage !== "cancelled" && (
                          <button
                            type="button"
                            onClick={() => void convertDocument(doc)}
                            title="تحويل لفاتورة"
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#9ec5f5] bg-[#eaf4ff] px-2.5 text-[11px] font-bold text-[#0b5fc4] shadow-sm transition hover:bg-[#d7ebff]"
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
                            <span className="hidden sm:inline">تحويل لفاتورة</span>
                          </button>
                        )}
                        {(NEXT_STAGES[doc.stage] || []).length > 0 && (
                          <select
                            className="rounded border border-[#e1e6ee] px-1.5 py-0.5 text-[11px]"
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                void changeStage(doc, e.target.value as DocumentStage);
                              }
                            }}
                          >
                            <option value="">تغيير المرحلة</option>
                            {(NEXT_STAGES[doc.stage] || []).map((stage) => (
                              <option key={stage} value={stage}>
                                {DOCUMENT_STAGE_LABELS[stage]}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-[#98a2b3]">
                      {stageFilter
                        ? `لا توجد وثائق بحالة «${DOCUMENT_STAGE_LABELS[stageFilter as DocumentStage]}»`
                        : searchTerm.trim()
                          ? "لا توجد نتائج مطابقة للبحث"
                          : "لا توجد وثائق في هذا التبويب"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={!!mode}
        onClose={() => setMode(null)}
        title={
          mode === "create"
            ? createLabel
            : `${mode === "edit" ? "تعديل" : "عرض"} ${activeDoc?.document_number || ""}`
        }
        wide
        className="max-w-2xl"
      >
            <form onSubmit={handleSave} className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
              <div className="grid gap-4 sm:grid-cols-2">
                {activeType === "purchase_order" ? (
                  <>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-[#344054]">
                        المورد
                      </label>
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
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-[#344054]">
                        تاريخ التوريد المتوقع
                      </label>
                      <DateField
                        disabled={readOnly}
                        value={form.expected_date}
                        onChange={(value) => setForm({ ...form, expected_date: value })}
                        inputClassName="border-[#e1e6ee] disabled:bg-slate-50"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-[#344054]">
                        العميل
                      </label>
                      {readOnly ? (
                        <p className="rounded-lg border border-[#e1e6ee] bg-slate-50 px-3 py-2 text-sm text-[#172033]">
                          {customers.find((c) => c.id === form.customer_id)?.name || "—"}
                        </p>
                      ) : (
                        <select
                          required
                          value={form.customer_id}
                          onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                          className="w-full rounded-lg border border-[#e1e6ee] px-3 py-2 text-sm"
                        >
                          <option value="">اختر العميل</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-[#344054]">
                        صالح حتى
                      </label>
                      <DateField
                        disabled={readOnly}
                        value={form.valid_until}
                        onChange={(value) => setForm({ ...form, valid_until: value })}
                        inputClassName="border-[#e1e6ee] disabled:bg-slate-50"
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#344054]">المرحلة</label>
                  {readOnly || mode === "create" ? (
                    <p className="rounded-lg border border-[#e1e6ee] bg-slate-50 px-3 py-2 text-sm text-[#172033]">
                      {DOCUMENT_STAGE_LABELS[form.stage] || form.stage}
                    </p>
                  ) : (
                    <select
                      value={form.stage}
                      onChange={(e) =>
                        setForm({ ...form, stage: e.target.value as DocumentStage })
                      }
                      className="w-full rounded-lg border border-[#e1e6ee] px-3 py-2 text-sm"
                    >
                      {STAGE_FLOW.filter((s) => s !== "converted").map((stage) => (
                        <option key={stage} value={stage}>
                          {DOCUMENT_STAGE_LABELS[stage]}
                        </option>
                      ))}
                    </select>
                  )}
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

              <div className="rounded-xl border border-[#eef1f6] bg-[#f7f9fc]/60 p-4">
                <h3 className="mb-2 text-sm font-semibold text-[#172033]">البنود</h3>
                {!readOnly && (
                  <div className="relative mb-3">
                    <input
                      type="text"
                      placeholder="ابحث لإضافة صنف..."
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="w-full rounded-lg border border-[#e1e6ee] bg-white px-3 py-1.5 text-xs"
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
                                {formatCurrency(
                                  activeType === "purchase_order" ? p.buy_price : p.sell_price
                                )}
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
                        <th className="w-24 px-3 py-1.5 text-right">السعر</th>
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

              <div className="rounded-lg border border-[#e1e6ee] bg-[#f7f9fc] px-3 py-2 text-sm font-bold text-[#1473e6]">
                الإجمالي: {formatCurrency(calculatedTotal)}
              </div>

              {!readOnly && (
                <div className="flex gap-3 border-t border-[#eef1f6] pt-4">
                  <button
                    type="submit"
                    disabled={saving || missingTable}
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

      {showListPrint && (
        <PrintReportPreview
          title={
            activeType === "purchase_order"
              ? "تقرير طلبات المشتريات"
              : "تقرير عروض الأسعار"
          }
          rows={sorted}
          columns={documentListColumns}
          settings={settings}
          summary={[
            { label: "العدد", value: String(sorted.length) },
            { label: "الإجمالي", value: formatCurrency(listTotal) },
          ]}
          onClose={() => setShowListPrint(false)}
        />
      )}

      {docPrint && (
        <DocumentPrintPreview
          kind={activeType}
          documentNumber={docPrint.doc.document_number}
          items={docPrint.items}
          partyName={docPrint.partyName}
          partyPhone={docPrint.partyPhone}
          subtotal={
            Number(docPrint.doc.subtotal) ||
            docPrint.items.reduce((s, i) => s + i.total, 0)
          }
          discount={Number(docPrint.doc.discount_amount) || 0}
          taxAmount={Number(docPrint.doc.tax_amount) || 0}
          total={Number(docPrint.doc.total)}
          notes={docPrint.doc.notes}
          stage={docPrint.doc.stage}
          cashierName={profile?.full_name || "الكاشير"}
          settings={settings}
          issuedAt={docPrint.doc.created_at}
          onClose={() => setDocPrint(null)}
        />
      )}
      {contextMenu}
    </div>
  );
}
