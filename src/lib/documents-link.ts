import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Marks converted quotes / purchase orders as cancelled when their invoice is about to be deleted.
 * A DB trigger also enforces this; this helper keeps the UI consistent and records a clear note.
 */
export async function cancelDocumentsLinkedToInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  invoiceNumber?: string
) {
  const note =
    "أُلغي تلقائياً بعد حذف الفاتورة المرتبطة" +
    (invoiceNumber ? ` ${invoiceNumber}` : "");

  const { data: linked } = await supabase
    .from("documents")
    .select("id, notes, stage")
    .eq("converted_invoice_id", invoiceId)
    .eq("stage", "converted");

  if (!linked?.length) return 0;

  for (const doc of linked) {
    const existing = (doc.notes || "").trim();
    const nextNotes =
      !existing
        ? note
        : existing.includes("أُلغي تلقائياً بعد حذف الفاتورة")
          ? existing
          : `${existing}\n${note}`;

    await supabase
      .from("documents")
      .update({ stage: "cancelled", notes: nextNotes })
      .eq("id", doc.id);
  }

  return linked.length;
}
