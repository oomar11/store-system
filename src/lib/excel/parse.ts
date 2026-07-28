import * as XLSX from "xlsx";
import {
  type ColumnDef,
  mapHeadersToKeys,
  normalizeHeader,
} from "./schemas";

export type ParsedSheet = {
  headers: string[];
  rows: Record<string, unknown>[];
  rawRowCount: number;
};

/** Raw sheet for manual column mapping + editable import. */
export type RawSheet = {
  headers: string[];
  /** Data rows as string cells aligned to header indexes */
  matrix: string[][];
};

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

function readAoa(buffer: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
}

/** Read Excel/CSV as headers + raw matrix (no field mapping yet). */
export function readExcelRaw(buffer: ArrayBuffer): RawSheet {
  const aoa = readAoa(buffer);
  if (!aoa.length) return { headers: [], matrix: [] };

  const headerRow = (aoa[0] ?? []).map((h) => cellToString(h));
  // Keep trailing empty headers trimmed, but preserve column indexes
  let last = headerRow.length - 1;
  while (last >= 0 && !normalizeHeader(headerRow[last])) last--;
  const headers = headerRow.slice(0, last + 1);

  const matrix: string[][] = [];
  for (let r = 1; r < aoa.length; r++) {
    const line = aoa[r] ?? [];
    const cells = headers.map((_, i) => cellToString(line[i]));
    if (cells.some((c) => c !== "")) matrix.push(cells);
  }

  return { headers, matrix };
}

/** Map raw matrix to keyed objects using column-index → field-key mapping. */
export function applyColumnMapping(
  matrix: string[][],
  mapping: Record<number, string>
): Record<string, unknown>[] {
  const entries = Object.entries(mapping).filter(([, key]) => key);
  return matrix
    .map((cells) => {
      const obj: Record<string, unknown> = {};
      let hasAny = false;
      for (const [indexStr, key] of entries) {
        const index = Number(indexStr);
        const str = cells[index] ?? "";
        if (str !== "") hasAny = true;
        obj[key] = str;
      }
      return hasAny ? obj : null;
    })
    .filter((r): r is Record<string, unknown> => r != null);
}

/** Auto-suggest mapping from headers using aliases. */
export function suggestColumnMapping(
  headers: string[],
  columns: ColumnDef[]
): Record<number, string> {
  return mapHeadersToKeys(headers, columns);
}

export function parseExcelFile(
  buffer: ArrayBuffer,
  columns: ColumnDef[]
): ParsedSheet {
  const raw = readExcelRaw(buffer);
  const mapping = suggestColumnMapping(raw.headers, columns);
  const rows = applyColumnMapping(raw.matrix, mapping);

  return {
    headers: raw.headers.filter((h) => normalizeHeader(h)),
    rows,
    rawRowCount: raw.matrix.length,
  };
}

export function parseBoolean(value: unknown, defaultValue = true): boolean {
  const s = cellToString(value).toLowerCase();
  if (!s) return defaultValue;
  if (["1", "true", "yes", "y", "نعم", "صح", "نشط", "active"].includes(s)) {
    return true;
  }
  if (["0", "false", "no", "n", "لا", "غير نشط", "inactive"].includes(s)) {
    return false;
  }
  return defaultValue;
}

export function parseNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = cellToString(value)
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");
  if (!s || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export { cellToString };
