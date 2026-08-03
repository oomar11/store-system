import { formatCurrency } from "@/lib/utils";

/** True when list (retail) price is higher than charged unit price. */
export function hasListMarkdown(
  listUnitPrice: number | null | undefined,
  unitPrice: number
): boolean {
  return (
    listUnitPrice != null &&
    Number.isFinite(Number(listUnitPrice)) &&
    Number(listUnitPrice) > Number(unitPrice) + 0.001
  );
}

/** Arabic before/after labels for tier markdown on a line. */
export function formatListMarkdownLabel(
  listUnitPrice: number,
  unitPrice: number
): string {
  return `قبل: ${formatCurrency(listUnitPrice)} → بعد: ${formatCurrency(unitPrice)}`;
}
