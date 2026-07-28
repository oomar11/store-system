import type { SupabaseClient } from "@supabase/supabase-js";

export type DocumentNumberKind =
  | "sale"
  | "purchase"
  | "quote"
  | "purchase_order"
  | "sale_return"
  | "purchase_return"
  | "inventory_count";

/** Allocate the next unique document number from Postgres (atomic). */
export async function allocateDocumentNumber(
  supabase: SupabaseClient,
  kind: DocumentNumberKind
): Promise<string> {
  const { data, error } = await supabase.rpc("next_document_number", {
    p_kind: kind,
  });

  if (error) {
    throw new Error(error.message || "تعذر توليد رقم المستند");
  }

  const value = typeof data === "string" ? data.trim() : "";
  if (!value) {
    throw new Error("تعذر توليد رقم المستند");
  }

  return value;
}
