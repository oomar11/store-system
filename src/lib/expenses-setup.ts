/** SQL اختياري للفهارس وحسابات المصروفات (يُزرع أيضاً من التطبيق عند فتح الصفحة) */
export const EXPENSE_SETUP_SQL = `-- ويندور: نظام المصروفات
INSERT INTO accounts (code, name, type, parent_id)
SELECT v.code, v.name, 'expense', p.id
FROM (VALUES
  ('5210', 'إيجار'),
  ('5220', 'كهرباء ومياه'),
  ('5230', 'رواتب وأجور'),
  ('5240', 'صيانة'),
  ('5250', 'مواصلات'),
  ('5260', 'اتصالات وإنترنت'),
  ('5290', 'مصروفات أخرى')
) AS v(code, name)
LEFT JOIN accounts p ON p.code = '5200'
ON CONFLICT (code) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_safe_transactions_reference
  ON safe_transactions(reference_type, reference_id);
`;

export const EXPENSE_SETUP_SQL_URL =
  "https://supabase.com/dashboard/project/qcvhddjvftpjczdxcfjz/sql/new";
