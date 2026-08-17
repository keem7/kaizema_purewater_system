-- 2026-08-13_001_add_password_hash.sql
-- Adds password_hash + password_algo columns to support the migration from
-- plaintext to bcrypt-hashed passwords. The plaintext `password` column is
-- retained for one release so we can roll back if any hash fails; drop it in
-- a follow-up migration after confirming all rows are password_algo='bcrypt'.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_algo TEXT NOT NULL DEFAULT 'plain';

-- Speeds up the case-insensitive username lookup used by /api/auth.
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));