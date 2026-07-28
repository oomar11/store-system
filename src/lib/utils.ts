import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date));
}

export function formatDateShort(date: string | Date): string {
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
}

export function formatDateRelative(date: string | Date): string {
  const d = new Date(date);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "اليوم";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "أمس";
  return formatDateShort(d);
}

/** Parse number input without snapping empty field back to a fallback mid-typing. */
export function parseNumberInput(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export const INVENTORY_COUNT_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  in_progress: "جارٍ",
  completed: "مكتمل",
  cancelled: "ملغي",
};

export const INVENTORY_COUNT_STATUS_COLORS: Record<string, string> = {
  draft:
    "bg-[color-mix(in_srgb,var(--muted)_18%,var(--surface))] text-[var(--muted)]",
  in_progress:
    "bg-[color-mix(in_srgb,var(--warning)_22%,var(--surface))] text-[var(--warning)]",
  completed:
    "bg-[color-mix(in_srgb,var(--success)_22%,var(--surface))] text-[var(--success)]",
  cancelled:
    "bg-[var(--surface-muted)] text-[var(--muted-soft)]",
};

export const DOCUMENT_STAGE_LABELS: Record<string, string> = {
  draft: "مسودة",
  sent: "مُرسل",
  approved: "معتمد",
  rejected: "مرفوض",
  converted: "محوّل لفاتورة",
  cancelled: "ملغي",
};

export const DOCUMENT_STAGE_COLORS: Record<string, string> = {
  draft:
    "bg-[color-mix(in_srgb,var(--muted)_18%,var(--surface))] text-[var(--muted)]",
  sent:
    "bg-[color-mix(in_srgb,var(--primary)_18%,var(--surface))] text-[var(--primary)]",
  approved:
    "bg-[color-mix(in_srgb,var(--success)_22%,var(--surface))] text-[var(--success)]",
  rejected:
    "bg-[color-mix(in_srgb,var(--danger)_18%,var(--surface))] text-[var(--danger)]",
  converted:
    "bg-[color-mix(in_srgb,#8b5cf6_18%,var(--surface))] text-[#a78bfa]",
  cancelled:
    "bg-[var(--surface-muted)] text-[var(--muted-soft)]",
};

export function normalizeArabic(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    // Remove tashkeel (diacritics)
    .replace(/[\u064B-\u065F]/g, "")
    // Normalize Alif
    .replace(/[أإآ]/g, "ا")
    // Normalize Yaa / Alif Maqsurah
    .replace(/ى/g, "ي")
    // Normalize Taa Marbutah
    .replace(/ة/g, "ه")
    // Replace multiple spaces with a single space
    .trim()
    .replace(/\s+/g, " ");
}

export function smartSearchMatch(
  searchQuery: string,
  fields: (string | null | undefined)[]
): boolean {
  if (!searchQuery) return true;
  const normalizedQuery = normalizeArabic(searchQuery);
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);

  if (queryTokens.length === 0) return true;

  const combinedText = fields
    .filter(Boolean)
    .map((field) => normalizeArabic(field as string))
    .join(" ");

  return queryTokens.every((token) => combinedText.includes(token));
}

const toneBg = (token: string, amount = 20) =>
  `bg-[color-mix(in_srgb,var(${token})_${amount}%,var(--surface))]`;

const toneText = (token: string, amount = 68) =>
  `text-[color-mix(in_srgb,var(${token})_${amount}%,var(--foreground))]`;

const toneBorder = (token: string, amount = 38) =>
  `border border-[color-mix(in_srgb,var(${token})_${amount}%,var(--border))]`;

/** Theme-aware stock quantity pill for POS and inventory lists. */
export function stockQtyBadgeClass(
  status: "out" | "low" | "ok",
  extra = ""
): string {
  const tones: Record<typeof status, string> = {
    out: `${toneBg("--danger")} ${toneText("--danger")}`,
    low: `${toneBg("--warning")} ${toneText("--warning")}`,
    ok: `${toneBg("--success")} ${toneText("--success")}`,
  };
  return `inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold max-lg:px-3 max-lg:py-1 max-lg:text-sm ${tones[status]} ${extra}`.trim();
}

const PAYMENT_CHIP_BASE =
  "flex-1 rounded-lg py-2 text-xs font-medium max-lg:min-h-12 max-lg:py-3 max-lg:text-sm max-lg:font-bold";

/** Theme-aware cash/credit toggle chips in POS checkout. */
export function paymentMethodChipClass(
  method: "cash" | "credit",
  active: boolean
): string {
  if (!active) {
    return `${PAYMENT_CHIP_BASE} bg-[var(--surface-muted)] text-[var(--muted)] border border-transparent`;
  }
  const token = method === "cash" ? "--success" : "--warning";
  return `${PAYMENT_CHIP_BASE} ${toneBg(token)} ${toneText(token, 75)} ${toneBorder(token)}`;
}

/** Muted success/warning text for payment amounts (change due, credit remaining). */
export function paymentAmountTextClass(kind: "success" | "warning"): string {
  const token = kind === "success" ? "--success" : "--warning";
  return `${toneText(token, 72)} font-bold`;
}

