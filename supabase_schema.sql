-- ================================================================
-- WELMES B2B Wholesale Platform — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ================================================================

-- 1. Members (linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id      UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  business_number TEXT NOT NULL DEFAULT '',
  representative  TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  registered_date DATE DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Products
CREATE TABLE IF NOT EXISTS products (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  brand           TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT 'Skincare',
  image           TEXT DEFAULT '',
  original_price  INTEGER NOT NULL DEFAULT 0,
  wholesale_price INTEGER NOT NULL DEFAULT 0,
  discount        INTEGER DEFAULT 0,
  tags            TEXT[] DEFAULT '{}',
  rating          NUMERIC(3,1) DEFAULT 0,
  reviews         INTEGER DEFAULT 0,
  description     TEXT DEFAULT '',
  stock           INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','inactive')),
  set_options     JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Orders
CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,          -- ORD-YYYYMMDD-XXX
  member_id        UUID REFERENCES members(id),
  member_name      TEXT NOT NULL,
  subtotal         INTEGER NOT NULL DEFAULT 0,
  vat              INTEGER NOT NULL DEFAULT 0,
  total            INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','processing','shipped','completed','cancelled')),
  date             DATE DEFAULT CURRENT_DATE,
  po_number        TEXT,
  notes            TEXT,
  shipping_address JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Order Items (product snapshot at time of order)
CREATE TABLE IF NOT EXISTS order_items (
  id               BIGSERIAL PRIMARY KEY,
  order_id         TEXT REFERENCES orders(id) ON DELETE CASCADE,
  product_snapshot JSONB NOT NULL,   -- full product object at purchase time
  quantity         INTEGER NOT NULL DEFAULT 1,
  set_option       JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- Row Level Security
-- ================================================================
ALTER TABLE members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Helper: check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM members
    WHERE auth_id = auth.uid() AND is_admin = TRUE
  );
$$;

-- ── Products ──────────────────────────────────────────
-- Anyone can read products (price display controlled in app)
CREATE POLICY "products_select" ON products FOR SELECT USING (true);
-- Only admins can write
CREATE POLICY "products_insert" ON products FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "products_update" ON products FOR UPDATE USING (is_admin());
CREATE POLICY "products_delete" ON products FOR DELETE USING (is_admin());

-- ── Members ───────────────────────────────────────────
-- Own row OR admin sees all
CREATE POLICY "members_select_own" ON members FOR SELECT
  USING (auth_id = auth.uid() OR is_admin());
-- New signup: insert own row
CREATE POLICY "members_insert_own" ON members FOR INSERT
  WITH CHECK (auth_id = auth.uid());
-- Own row update (profile) OR admin updates any
CREATE POLICY "members_update" ON members FOR UPDATE
  USING (auth_id = auth.uid() OR is_admin());

-- ── Orders ────────────────────────────────────────────
-- Own orders OR admin sees all
CREATE POLICY "orders_select" ON orders FOR SELECT
  USING (
    member_id IN (SELECT id FROM members WHERE auth_id = auth.uid())
    OR is_admin()
  );
CREATE POLICY "orders_insert" ON orders FOR INSERT
  WITH CHECK (
    member_id IN (SELECT id FROM members WHERE auth_id = auth.uid())
  );
CREATE POLICY "orders_update" ON orders FOR UPDATE USING (is_admin());

-- ── Order Items ───────────────────────────────────────
CREATE POLICY "order_items_select" ON order_items FOR SELECT
  USING (
    order_id IN (
      SELECT o.id FROM orders o
      JOIN members m ON o.member_id = m.id
      WHERE m.auth_id = auth.uid()
    ) OR is_admin()
  );
CREATE POLICY "order_items_insert" ON order_items FOR INSERT
  WITH CHECK (
    order_id IN (
      SELECT o.id FROM orders o
      JOIN members m ON o.member_id = m.id
      WHERE m.auth_id = auth.uid()
    )
  );

-- ================================================================
-- Trigger: auto-create member row after Supabase Auth signup
-- ================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO members (auth_id, email, company_name, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'company_name', ''),
    'pending'
  )
  ON CONFLICT (auth_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
