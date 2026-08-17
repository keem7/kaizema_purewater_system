-- 2026-08-13_002_create_settings.sql
-- Single-row settings table holding the configurable unit price.
-- Public read so the login screen can render "Price: NLE X" if desired;
-- all writes go through the admin-gated API.

CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (id, unit_price) VALUES (1, 10)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settings_public_read ON settings;
CREATE POLICY settings_public_read ON settings
  FOR SELECT USING (true);