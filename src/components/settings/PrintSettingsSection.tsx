"use client";

import { useRef } from "react";
import {
  AlignHorizontalSpaceAround,
  Check,
  FileText,
  LayoutTemplate,
  Printer,
  Receipt,
  Settings2,
  Tag,
  Zap,
} from "lucide-react";
import { printReceiptElement } from "@/lib/print";
import {
  PRINT_DOC_KEYS,
  PRINT_KIND_LABELS,
  PRINT_PRESETS,
  type BarcodeLabelSize,
  type PrintDocKey,
  type PrintFontSize,
  type PrintLayout,
  type ReceiptWidth,
} from "@/lib/print-formats";
import type { SettingsFormState } from "./settings-form";
import { SettingsCard, SettingsField, SettingsFieldGrid } from "./SettingsCard";

type PrintSettingsSectionProps = {
  form: SettingsFormState;
  setForm: React.Dispatch<React.SetStateAction<SettingsFormState>>;
};

function patchFormats(
  form: SettingsFormState,
  setForm: PrintSettingsSectionProps["setForm"],
  patch: Partial<SettingsFormState["print_formats"]>
) {
  setForm({
    ...form,
    print_formats: { ...form.print_formats, ...patch },
  });
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="print-seg" role="group">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`print-seg__btn ${active ? "print-seg__btn--active" : ""}`}
          >
            <span>{opt.label}</span>
            {opt.hint ? (
              <span className="print-seg__hint">{opt.hint}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="print-toggle-row">
      <div className="min-w-0">
        <p className="text-sm font-bold text-[var(--foreground)]">{label}</p>
        {hint ? <p className="text-xs text-[var(--muted)]">{hint}</p> : null}
      </div>
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div className="peer h-6 w-11 rounded-full bg-[var(--surface-muted)] after:absolute after:right-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-[var(--border)] after:bg-white after:transition-all after:content-[''] peer-checked:bg-[var(--primary)] peer-checked:after:translate-x-full peer-checked:after:border-white rtl:peer-checked:after:-translate-x-full" />
      </label>
    </div>
  );
}

export function PrintSettingsSection({
  form,
  setForm,
}: PrintSettingsSectionProps) {
  const testPrintRef = useRef<HTMLDivElement>(null);
  const pf = form.print_formats;
  const widthMm = pf.receipt_width === "58" ? 58 : 80;
  const previewWidthPx = widthMm === 58 ? 148 : 180;

  function setPrintLayout(key: PrintDocKey, layout: PrintLayout) {
    patchFormats(form, setForm, { [key]: layout });
  }

  function applyPreset(key: keyof typeof PRINT_PRESETS) {
    const { patch } = PRINT_PRESETS[key];
    patchFormats(form, setForm, patch);
  }

  const receiptCount = PRINT_DOC_KEYS.filter((k) => pf[k] === "receipt_80").length;
  const a4Count = PRINT_DOC_KEYS.length - receiptCount;

  return (
    <div className="space-y-5">
      {/* Summary + presets */}
      <div className="print-hero">
        <div className="print-hero__main">
          <div className="print-hero__icon">
            <Printer className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-[var(--foreground)]">
              إعدادات الطباعة
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
              حراري {widthMm}مم · {receiptCount} مستند إيصال · {a4Count} مستند A4
              {pf.auto_print_sale ? " · طباعة تلقائية بعد البيع" : ""}
            </p>
          </div>
        </div>
        <div className="print-preset-row">
          {(
            Object.keys(PRINT_PRESETS) as Array<keyof typeof PRINT_PRESETS>
          ).map((key) => {
            const preset = PRINT_PRESETS[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className="print-preset-btn"
              >
                <Zap className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="min-w-0">
                  <span className="block text-[11px] font-extrabold leading-tight">
                    {preset.label}
                  </span>
                  <span className="block text-[10px] leading-tight text-[var(--muted)]">
                    {preset.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="print-settings-grid">
        <div className="space-y-5">
          {/* Document layouts */}
          <SettingsCard
            title="تنسيق المستندات"
            description="لكل نوع مستند: إيصال حراري أو ورق A4."
            icon={LayoutTemplate}
          >
            <div className="space-y-2">
              {PRINT_DOC_KEYS.map((key) => (
                <div key={key} className="print-doc-row">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`print-doc-dot ${
                        pf[key] === "a4"
                          ? "print-doc-dot--a4"
                          : "print-doc-dot--receipt"
                      }`}
                    />
                    <span className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {PRINT_KIND_LABELS[key]}
                    </span>
                  </div>
                  <Segmented
                    value={pf[key]}
                    onChange={(layout) => setPrintLayout(key, layout)}
                    options={[
                      { value: "receipt_80", label: "حراري" },
                      { value: "a4", label: "A4" },
                    ]}
                  />
                </div>
              ))}
            </div>
          </SettingsCard>

          {/* Thermal printer */}
          <SettingsCard
            title="الطابعة الحرارية"
            description="عرض الورق، حجم الخط، ومحاذاة الهامش."
            icon={Receipt}
          >
            <div className="space-y-4">
              <SettingsField label="عرض الورق">
                <Segmented<ReceiptWidth>
                  value={pf.receipt_width}
                  onChange={(receipt_width) =>
                    patchFormats(form, setForm, { receipt_width })
                  }
                  options={[
                    { value: "58", label: "58 مم", hint: "مضغوط" },
                    { value: "80", label: "80 مم", hint: "قياسي" },
                  ]}
                />
              </SettingsField>

              <SettingsField label="حجم الخط">
                <Segmented<PrintFontSize>
                  value={pf.font_size}
                  onChange={(font_size) =>
                    patchFormats(form, setForm, { font_size })
                  }
                  options={[
                    { value: "small", label: "صغير" },
                    { value: "normal", label: "عادي" },
                    { value: "large", label: "كبير" },
                  ]}
                />
              </SettingsField>

              <SettingsField
                label="إزاحة الهامش الأفقي (ملم)"
                hint="لو الطابعة بتقص طرف الفاتورة، حرّك المحتوى يمين أو شمال."
              >
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="range"
                    min={-15}
                    max={15}
                    step={1}
                    value={form.print_offset}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        print_offset: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="print-offset-range min-w-0 flex-1"
                    dir="ltr"
                  />
                  <input
                    type="number"
                    min={-15}
                    max={15}
                    value={form.print_offset}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        print_offset: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="settings-input w-20"
                    dir="ltr"
                  />
                </div>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
                  <AlignHorizontalSpaceAround className="h-3.5 w-3.5" />
                  {form.print_offset > 0
                    ? `إزاحة لليمين +${form.print_offset} مم`
                    : form.print_offset < 0
                      ? `إزاحة لليسار -${Math.abs(form.print_offset)} مم`
                      : "محاذاة افتراضية بالمنتصف"}
                </p>
              </SettingsField>
            </div>
          </SettingsCard>

          {/* Content visibility */}
          <SettingsCard
            title="محتوى الفاتورة"
            description="اختر إيه يظهر على الإيصال والمستندات."
            icon={Settings2}
          >
            <div className="space-y-1">
              <ToggleRow
                label="شعار المحل"
                checked={pf.show_logo}
                onChange={(show_logo) =>
                  patchFormats(form, setForm, { show_logo })
                }
              />
              <ToggleRow
                label="العنوان والهاتف"
                checked={pf.show_address}
                onChange={(show_address) =>
                  patchFormats(form, setForm, { show_address })
                }
              />
              <ToggleRow
                label="الرقم الضريبي والسجل"
                checked={pf.show_tax_info}
                onChange={(show_tax_info) =>
                  patchFormats(form, setForm, { show_tax_info })
                }
              />
              <ToggleRow
                label="اسم الكاشير"
                checked={pf.show_cashier}
                onChange={(show_cashier) =>
                  patchFormats(form, setForm, { show_cashier })
                }
              />
              <ToggleRow
                label="كود الصنف (SKU)"
                hint="يظهر تحت اسم الصنف في جدول الفاتورة"
                checked={pf.show_sku}
                onChange={(show_sku) =>
                  patchFormats(form, setForm, { show_sku })
                }
              />
              <ToggleRow
                label="خصم السطر"
                hint="يعرض خصم كل صنف تحت الإجمالي"
                checked={pf.show_item_discount}
                onChange={(show_item_discount) =>
                  patchFormats(form, setForm, { show_item_discount })
                }
              />
            </div>
          </SettingsCard>

          {/* Behavior */}
          <SettingsCard
            title="سلوك الطباعة"
            description="طباعة تلقائية وعدد النسخ بعد البيع."
            icon={FileText}
          >
            <div className="space-y-4">
              <ToggleRow
                label="طباعة تلقائية بعد البيع"
                hint="يفتح حوار الطباعة مباشرة بعد حفظ فاتورة البيع"
                checked={pf.auto_print_sale}
                onChange={(auto_print_sale) =>
                  patchFormats(form, setForm, { auto_print_sale })
                }
              />
              <SettingsField label="عدد النسخ">
                <Segmented
                  value={String(pf.print_copies) as "1" | "2" | "3"}
                  onChange={(v) =>
                    patchFormats(form, setForm, {
                      print_copies: Number(v) as 1 | 2 | 3,
                    })
                  }
                  options={[
                    { value: "1", label: "نسخة" },
                    { value: "2", label: "نسختان" },
                    { value: "3", label: "3 نسخ" },
                  ]}
                />
              </SettingsField>
              <ToggleRow
                label="منطقة توقيع وختم (A4)"
                hint="تظهر في أسفل المستندات المطبوعة على ورق A4"
                checked={pf.a4_show_signature}
                onChange={(a4_show_signature) =>
                  patchFormats(form, setForm, { a4_show_signature })
                }
              />
            </div>
          </SettingsCard>

          {/* Barcode labels */}
          <SettingsCard
            title="ملصقات الباركود"
            description="الحجم الافتراضي ومحتوى الملصق."
            icon={Tag}
          >
            <div className="space-y-4">
              <SettingsField label="حجم الملصق">
                <Segmented<BarcodeLabelSize>
                  value={pf.barcode_label_size}
                  onChange={(barcode_label_size) =>
                    patchFormats(form, setForm, { barcode_label_size })
                  }
                  options={[
                    { value: "small", label: "صغير" },
                    { value: "medium", label: "متوسط" },
                    { value: "large", label: "كبير" },
                  ]}
                />
              </SettingsField>
              <SettingsFieldGrid>
                <ToggleRow
                  label="اسم المنتج"
                  checked={pf.barcode_show_name}
                  onChange={(barcode_show_name) =>
                    patchFormats(form, setForm, { barcode_show_name })
                  }
                />
                <ToggleRow
                  label="السعر"
                  checked={pf.barcode_show_price}
                  onChange={(barcode_show_price) =>
                    patchFormats(form, setForm, { barcode_show_price })
                  }
                />
              </SettingsFieldGrid>
            </div>
          </SettingsCard>
        </div>

        {/* Live preview column */}
        <div className="print-preview-col">
          <SettingsCard
            title="معاينة حية"
            description={`إيصال ${widthMm}مم — يتحدّث مع الإعدادات.`}
            icon={Printer}
          >
            <div className="flex flex-col items-center">
              <div
                className="print-paper select-none border border-[var(--border)] bg-white p-3 text-black shadow-sm"
                style={{
                  width: previewWidthPx,
                  transition: "width 0.2s ease",
                }}
              >
                <div
                  style={{
                    paddingLeft:
                      form.print_offset > 0
                        ? `${form.print_offset * 1.5}px`
                        : undefined,
                    paddingRight:
                      form.print_offset < 0
                        ? `${Math.abs(form.print_offset) * 1.5}px`
                        : undefined,
                    transition: "padding 0.15s ease",
                    fontSize:
                      pf.font_size === "small"
                        ? "8px"
                        : pf.font_size === "large"
                          ? "10px"
                          : "9px",
                    lineHeight: 1.35,
                  }}
                >
                  {pf.show_logo && form.logo_url.trim() ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.logo_url.trim()}
                      alt=""
                      className="mx-auto mb-1 max-h-8 object-contain"
                    />
                  ) : null}
                  <div className="mb-1.5 border-b border-dashed border-gray-300 pb-1.5 text-center font-bold">
                    <span
                      style={{
                        fontSize:
                          pf.font_size === "large"
                            ? "13px"
                            : pf.font_size === "small"
                              ? "10px"
                              : "11px",
                      }}
                    >
                      {form.store_name || "ويندور"}
                    </span>
                    {form.invoice_tagline.trim() ? (
                      <p className="mt-0.5 text-[7px] font-normal text-gray-400">
                        {form.invoice_tagline.trim()}
                      </p>
                    ) : null}
                  </div>
                  {pf.show_address &&
                  (form.address.trim() || form.phone.trim()) ? (
                    <div className="mb-1 space-y-0.5 text-center text-[6px] text-gray-500">
                      {form.address.trim() ? <p>{form.address.trim()}</p> : null}
                      {form.phone.trim() ? (
                        <p dir="ltr">{form.phone.trim()}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {pf.show_tax_info &&
                  (form.tax_number.trim() ||
                    form.commercial_register.trim()) ? (
                    <div className="mb-1 space-y-0.5 text-center text-[6px] text-gray-500">
                      {form.tax_number.trim() ? (
                        <p>ضريبي: {form.tax_number.trim()}</p>
                      ) : null}
                      {form.commercial_register.trim() ? (
                        <p>س.ت: {form.commercial_register.trim()}</p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mb-1 flex justify-between text-[7px] text-gray-600">
                    <span>رقم: TEST-0001</span>
                    {pf.show_cashier ? <span>كاشير: أحمد</span> : null}
                  </div>
                  <div className="mb-1 flex justify-between font-bold text-slate-800">
                    <span>الصنف</span>
                    <span>الإجمالي</span>
                  </div>
                  <div className="space-y-1 font-medium text-gray-600">
                    <div>
                      <div className="flex justify-between">
                        <span>صنف تجريبي أ</span>
                        <span>10.00</span>
                      </div>
                      {pf.show_sku ? (
                        <p className="text-[6px] text-gray-400" dir="ltr">
                          SKU-001
                        </p>
                      ) : null}
                    </div>
                    <div className="flex justify-between">
                      <span>صنف تجريبي ب</span>
                      <span>20.00</span>
                    </div>
                  </div>
                  <div className="mt-1.5 flex justify-between border-t border-dashed border-gray-300 pt-1.5 font-bold text-slate-900">
                    <span>الإجمالي:</span>
                    <span>30.00 ج.م</span>
                  </div>
                  {form.receipt_footer.trim() ? (
                    <p className="mt-1.5 border-t border-dashed border-gray-300 pt-1 text-center text-[6px] text-gray-500">
                      {form.receipt_footer.trim()}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex w-full max-w-[200px] flex-col gap-2">
                <div className="flex flex-wrap justify-center gap-1.5">
                  {[
                    pf.receipt_width === "58" ? "58مم" : "80مم",
                    pf.font_size === "small"
                      ? "خط صغير"
                      : pf.font_size === "large"
                        ? "خط كبير"
                        : "خط عادي",
                    pf.print_copies > 1 ? `${pf.print_copies} نسخ` : null,
                    pf.auto_print_sale ? "تلقائي" : null,
                  ]
                    .filter(Boolean)
                    .map((chip) => (
                      <span key={String(chip)} className="print-chip">
                        <Check className="h-3 w-3" />
                        {chip}
                      </span>
                    ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const el = testPrintRef.current;
                    if (el) printReceiptElement(el, widthMm === 58 ? 58 : 80);
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--primary)] py-2.5 text-xs font-bold text-[var(--primary)] transition hover:bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface))]"
                >
                  <Printer className="h-4 w-4" />
                  طباعة تجربة
                </button>
              </div>
            </div>
          </SettingsCard>
        </div>
      </div>

      {/* Source for iframe test print (cloned, not window.print) */}
      <div ref={testPrintRef} className="hidden" dir="rtl" aria-hidden>
        <div
          style={{
            paddingLeft:
              form.print_offset > 0 ? `${form.print_offset}mm` : undefined,
            paddingRight:
              form.print_offset < 0
                ? `${Math.abs(form.print_offset)}mm`
                : undefined,
          }}
        >
          <div className="print-paper flex w-full flex-col text-black">
            {pf.show_logo && form.logo_url.trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.logo_url.trim()}
                alt=""
                className="mx-auto mb-1 max-h-12 object-contain"
              />
            ) : null}
            <div className="mb-2 border-b border-dashed border-gray-400 pb-2 text-center text-[12px] font-bold">
              <h1 className="text-sm font-black">
                {form.store_name || "ويندور"}
              </h1>
              {form.invoice_tagline.trim() ? (
                <p className="mt-0.5 text-[9px] font-normal text-gray-500">
                  {form.invoice_tagline.trim()}
                </p>
              ) : null}
              <p className="mt-1 text-[9px] font-bold text-gray-500">
                فاتورة تجربة محاذاة الطباعة ({widthMm}مم)
              </p>
            </div>
            <div className="my-2 space-y-0.5 text-[9px] text-slate-700">
              <div className="flex justify-between">
                <span>رقم الفاتورة:</span>
                <span className="font-bold">TEST-0001</span>
              </div>
              <div className="flex justify-between">
                <span>التاريخ:</span>
                <span>{new Date().toLocaleDateString("ar-EG")}</span>
              </div>
              {pf.show_cashier ? (
                <div className="flex justify-between">
                  <span>الكاشير:</span>
                  <span>تجربة</span>
                </div>
              ) : null}
            </div>
            <div className="mt-2 flex justify-between border-t border-dashed border-gray-400 pt-2 text-[10px] font-bold">
              <span>إجمالي التجربة:</span>
              <span>30.00 ج.م</span>
            </div>
            <div className="mt-4 border-t border-dashed border-gray-300 pt-2 text-center">
              <p className="text-[8px] font-bold text-gray-500">
                {form.receipt_footer.trim() ||
                  "تمت الطباعة لتجربة وضبط الهوامش"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
