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
    const msg = error.message || "تعذر توليد رقم المستند";
    // PostgREST HTTP 300 when function overloads are ambiguous
    if (
      /300|multiple.?choices|could not choose|PGRST203/i.test(msg) ||
      error.code === "PGRST203"
    ) {
      throw new Error(
        "تعذر توليد رقم المستند: تعارض في دالة الترقيم (next_document_number) — يلزم إصلاح الـ overloads في قاعدة البيانات"
      );
    }
    throw new Error(msg);
  }

  const value = typeof data === "string" ? data.trim() : "";
  if (!value) {
    throw new Error("تعذر توليد رقم المستند");
  }

  return value;
}
