import * as XLSX from "xlsx";

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function downloadWorkbook(
  rows: Record<string, unknown>[],
  filenameBase: string,
  sheetName = "Sheet1"
): void {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filenameBase}-${todayStamp()}.xlsx`);
}

export function downloadTemplate(
  headers: string[],
  exampleRow: Record<string, unknown>,
  filenameBase: string,
  sheetName = "Sheet1"
): void {
  const ordered: Record<string, unknown> = {};
  for (const h of headers) {
    ordered[h] = exampleRow[h] ?? "";
  }
  downloadWorkbook([ordered], `قالب-${filenameBase}`, sheetName);
}

/** Generic export from array of objects with Arabic (or any) column keys. */
export function exportRows(
  rows: Record<string, unknown>[],
  filenameBase: string,
  sheetName?: string
): void {
  if (rows.length === 0) {
    downloadWorkbook([{}], filenameBase, sheetName);
    return;
  }
  downloadWorkbook(rows, filenameBase, sheetName);
}
