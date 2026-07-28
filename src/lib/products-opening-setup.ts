/** SQL مطلوب مرة واحدة لتفعيل الرصيد الافتتاحي للأصناف */
export const PRODUCTS_OPENING_SETUP_SQL = `-- ويندور: رصيد افتتاحي للأصناف
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS opening_quantity DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE products
SET opening_quantity = quantity
WHERE opening_quantity = 0 AND quantity <> 0;
`;

export const PRODUCTS_OPENING_SETUP_SQL_URL =
  "https://supabase.com/dashboard/project/qcvhddjvftpjczdxcfjz/sql/new";

export function isOpeningQuantityMissing(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("opening_quantity") ||
    (m.includes("column") && m.includes("does not exist") && m.includes("opening"))
  );
}
