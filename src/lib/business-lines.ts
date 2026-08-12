/** Customer business-line tags: سلك / محل / ورشة */

export const BUSINESS_LINE_VALUES = ["wire", "store", "workshop"] as const;

export type BusinessLine = (typeof BUSINESS_LINE_VALUES)[number];

export const BUSINESS_LINE_LABELS: Record<BusinessLine, string> = {
  wire: "سلك",
  store: "محل",
  workshop: "ورشة",
};

export const BUSINESS_LINE_COLORS: Record<
  BusinessLine,
  { bg: string; text: string; border: string }
> = {
  wire: {
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
  },
  store: {
    bg: "bg-sky-50",
    text: "text-sky-800",
    border: "border-sky-200",
  },
  workshop: {
    bg: "bg-amber-50",
    text: "text-amber-900",
    border: "border-amber-200",
  },
};

export function isBusinessLine(value: unknown): value is BusinessLine {
  return (
    value === "wire" || value === "store" || value === "workshop"
  );
}

export function normalizeBusinessLines(
  values: unknown
): BusinessLine[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<BusinessLine>();
  const out: BusinessLine[] = [];
  for (const raw of values) {
    const v = String(raw || "").trim().toLowerCase();
    if (!isBusinessLine(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function mergeBusinessLines(
  ...groups: Array<BusinessLine[] | null | undefined>
): BusinessLine[] {
  return normalizeBusinessLines(groups.flatMap((g) => g || []));
}

export function businessLineLabel(line: BusinessLine): string {
  return BUSINESS_LINE_LABELS[line];
}

export function sourceSystemToBusinessLine(
  source: "aa" | "plisse" | "store" | string
): BusinessLine | null {
  const s = String(source || "").toLowerCase();
  if (s === "plisse" || s === "wire") return "wire";
  if (s === "aa" || s === "workshop") return "workshop";
  if (s === "store") return "store";
  return null;
}
