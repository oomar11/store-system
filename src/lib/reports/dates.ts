import type { DatePreset, DateRange } from "./types";

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function rangeFromPreset(preset: DatePreset, custom?: DateRange): DateRange {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (preset === "today") {
    const ymd = toYmd(today);
    return { from: ymd, to: ymd };
  }

  if (preset === "7days") {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from: toYmd(from), to: toYmd(today) };
  }

  if (preset === "month") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: toYmd(from), to: toYmd(today) };
  }

  return {
    from: custom?.from || toYmd(today),
    to: custom?.to || toYmd(today),
  };
}

export function rangeBounds(range: DateRange): { startIso: string; endIso: string } {
  return {
    startIso: `${range.from}T00:00:00`,
    endIso: `${range.to}T23:59:59`,
  };
}

export function isDateRangeInvalid(range: DateRange): boolean {
  return !!(range.from && range.to && range.from > range.to);
}

export function formatRangeLabel(range: DateRange): string {
  if (range.from === range.to) return range.from;
  return `${range.from} → ${range.to}`;
}

export function eachDayInRange(range: DateRange): string[] {
  const days: string[] = [];
  const cur = new Date(range.from + "T00:00:00");
  const end = new Date(range.to + "T00:00:00");
  while (cur <= end) {
    days.push(toYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}
