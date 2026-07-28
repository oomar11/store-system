import type { SupabaseClient } from "@supabase/supabase-js";
import type { Customer, Supplier } from "@/types";
import { PARTY_COLUMNS, getEntityLabel } from "./schemas";
import { downloadTemplate, exportRows } from "./download";
import { cellToString, parseNumber } from "./parse";

export type PartyKind = "customers" | "suppliers";

export type RowAction = "create" | "update" | "skip" | "error";

export type PartyPreviewRow = {
  rowIndex: number;
  action: RowAction;
  name: string;
  phone: string;
  errors: string[];
  warnings: string[];
  payload: PartyImportPayload | null;
  existingId?: string;
};

export type PartyImportPayload = {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  opening_balance: number;
  notes?: string | null;
  /** Only set on create: initial balance = opening_balance */
  setOpeningOnCreate: boolean;
};

const BATCH = 50;

type Party = Customer | Supplier;

export function partyExampleRow(): Record<string, unknown> {
  return {
    الاسم: "عميل تجريبي",
    الهاتف: "01000000000",
    البريد: "",
    العنوان: "القاهرة",
    "الرصيد الافتتاحي": 0,
    ملاحظات: "",
  };
}

export function downloadPartyTemplate(kind: PartyKind): void {
  downloadTemplate(
    PARTY_COLUMNS.map((c) => c.header),
    partyExampleRow(),
    getEntityLabel(kind),
    getEntityLabel(kind)
  );
}

export function exportParties(kind: PartyKind, parties: Party[]): void {
  const rows = parties.map((p) => ({
    الاسم: p.name,
    الهاتف: p.phone ?? "",
    البريد: p.email ?? "",
    العنوان: p.address ?? "",
    "الرصيد الافتتاحي": p.opening_balance ?? "",
    ملاحظات: p.notes ?? "",
  }));
  exportRows(rows, getEntityLabel(kind), getEntityLabel(kind));
}

function findExisting(parties: Party[], name: string, phone: string): Party | undefined {
  const phoneNorm = phone.replace(/\s+/g, "");
  if (phoneNorm) {
    const byPhone = parties.find(
      (p) => (p.phone ?? "").replace(/\s+/g, "") === phoneNorm
    );
    if (byPhone) return byPhone;
  }
  const nameKey = name.trim().toLowerCase();
  return parties.find((p) => p.name.trim().toLowerCase() === nameKey);
}

export function buildPartyPreview(
  rows: Record<string, unknown>[],
  existing: Party[]
): PartyPreviewRow[] {
  const seenPhone = new Set<string>();
  const seenName = new Set<string>();

  return rows.map((row, i) => {
    const rowIndex = i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];

    const name = cellToString(row.name);
    const phone = cellToString(row.phone);
    const email = cellToString(row.email);
    const address = cellToString(row.address);
    const notes = cellToString(row.notes);
    const openingRaw = row.opening_balance;
    const opening = parseNumber(openingRaw);

    if (!name) errors.push("الاسم مطلوب");
    if (openingRaw !== "" && openingRaw != null && opening === null) {
      errors.push("الرصيد الافتتاحي غير صالح");
    }

    const phoneKey = phone.replace(/\s+/g, "");
    if (phoneKey) {
      if (seenPhone.has(phoneKey)) errors.push("الهاتف مكرر في الملف");
      else seenPhone.add(phoneKey);
    } else if (name) {
      const nk = name.toLowerCase();
      if (seenName.has(nk)) warnings.push("اسم مكرر في الملف بدون هاتف");
      else seenName.add(nk);
    }

    const match = name ? findExisting(existing, name, phone) : undefined;
    const action: RowAction = errors.length
      ? "error"
      : match
        ? "update"
        : "create";

    if (action === "update") {
      warnings.push("الرصيد الجاري الحالي لن يُستبدل — يُحدَّث الرصيد الافتتاحي فقط");
    }

    const hasOpening = openingRaw !== "" && openingRaw != null && opening !== null;

    const payload: PartyImportPayload | null =
      errors.length === 0
        ? {
            name,
            phone: phone || null,
            email: email || null,
            address: address || null,
            opening_balance: opening ?? match?.opening_balance ?? 0,
            notes: notes || null,
            setOpeningOnCreate: hasOpening || action === "create",
          }
        : null;

    return {
      rowIndex,
      action,
      name,
      phone,
      errors,
      warnings,
      payload,
      existingId: match?.id,
    };
  });
}

export async function applyPartyImport(
  supabase: SupabaseClient,
  kind: PartyKind,
  preview: PartyPreviewRow[],
  onProgress?: (done: number, total: number) => void
): Promise<{ created: number; updated: number; failed: number }> {
  const table = kind;
  const valid = preview.filter(
    (r) => r.payload && (r.action === "create" || r.action === "update")
  );
  const total = valid.length;
  let created = 0;
  let updated = 0;
  let failed = 0;
  let done = 0;

  for (const row of valid) {
    const p = row.payload!;
    if (row.action === "create") {
      const opening = p.setOpeningOnCreate ? p.opening_balance : 0;
      const { error } = await supabase.from(table).insert({
        name: p.name,
        phone: p.phone,
        email: p.email,
        address: p.address,
        notes: p.notes,
        opening_balance: opening,
        balance: opening,
      });
      if (error) failed++;
      else created++;
    } else if (row.existingId) {
      const updatePayload: Record<string, unknown> = {
        name: p.name,
        phone: p.phone,
        email: p.email,
        address: p.address,
        notes: p.notes,
      };
      if (p.setOpeningOnCreate) {
        updatePayload.opening_balance = p.opening_balance;
      }
      const { error } = await supabase
        .from(table)
        .update(updatePayload)
        .eq("id", row.existingId);
      if (error) failed++;
      else updated++;
    }
    done++;
    onProgress?.(done, total);
  }

  return { created, updated, failed };
}
