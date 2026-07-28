-- When a linked invoice is deleted, mark the source quote / PO as cancelled
-- (instead of leaving stage = converted with a null invoice id).

CREATE OR REPLACE FUNCTION cancel_documents_on_invoice_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE documents
  SET
    stage = 'cancelled',
    notes = CASE
      WHEN notes IS NULL OR btrim(notes) = '' THEN
        'أُلغي تلقائياً بعد حذف الفاتورة المرتبطة ' || COALESCE(OLD.invoice_number, '')
      WHEN notes ILIKE '%أُلغي تلقائياً بعد حذف الفاتورة%' THEN
        notes
      ELSE
        notes || E'\nأُلغي تلقائياً بعد حذف الفاتورة المرتبطة ' || COALESCE(OLD.invoice_number, '')
    END,
    updated_at = NOW()
  WHERE converted_invoice_id = OLD.id
    AND stage = 'converted';

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_documents_on_invoice_delete ON invoices;
CREATE TRIGGER trg_cancel_documents_on_invoice_delete
  BEFORE DELETE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION cancel_documents_on_invoice_delete();

CREATE INDEX IF NOT EXISTS idx_documents_converted_invoice
  ON documents(converted_invoice_id);
