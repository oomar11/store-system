-- Print format preferences per document type (JSONB)
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS print_formats JSONB NOT NULL DEFAULT '{
    "sale": "receipt_80",
    "purchase": "receipt_80",
    "sale_return": "receipt_80",
    "purchase_return": "receipt_80",
    "quote": "receipt_80",
    "purchase_order": "a4",
    "barcode_label": "a4",
    "barcode_label_size": "small"
  }'::jsonb;

COMMENT ON COLUMN public.settings.print_formats IS
  'Per-document print layout: receipt_80 | a4, plus barcode_label_size';
