-- Add print_offset for receipt alignment settings
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS print_offset INTEGER NOT NULL DEFAULT 0;
