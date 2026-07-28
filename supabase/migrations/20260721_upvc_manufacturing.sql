-- UPVC manufacturing module: projects, units, quotations, jobs, BOM, production, QC, delivery
-- Shares customers / products / suppliers / safes with store POS.

-- ─── Helpers: permissions for manufacturing ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.effective_permissions(p_role text, p_permissions jsonb)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result text[];
BEGIN
  IF p_permissions IS NOT NULL AND jsonb_typeof(p_permissions) = 'array' THEN
    SELECT COALESCE(array_agg(x), ARRAY[]::text[])
    INTO result
    FROM jsonb_array_elements_text(p_permissions) AS t(x);
    RETURN result;
  END IF;

  IF p_role = 'owner' THEN
    RETURN ARRAY[
      'dashboard','pos','sales','purchases','products','products.write','inventory',
      'customers','customers.write','suppliers','treasury','expenses','reports',
      'settings','settings.backup','users.manage','invoices.delete','prices.edit',
      'shifts','audit','programs',
      'manufacturing','manufacturing.write','manufacturing.approve','manufacturing.produce',
      'manufacturing.qc','manufacturing.delivery','manufacturing.catalog','manufacturing.finance'
    ];
  ELSIF p_role = 'manager' THEN
    RETURN ARRAY[
      'dashboard','pos','sales','purchases','products','products.write','inventory',
      'customers','customers.write','suppliers','treasury','expenses','reports','prices.edit',
      'shifts','settings','audit','programs',
      'manufacturing','manufacturing.write','manufacturing.approve','manufacturing.produce',
      'manufacturing.qc','manufacturing.delivery','manufacturing.catalog','manufacturing.finance'
    ];
  ELSE
    RETURN ARRAY[
      'dashboard','pos','sales','products','inventory','customers','shifts','programs',
      'manufacturing','manufacturing.produce','manufacturing.qc'
    ];
  END IF;
END;
$$;

-- ─── Catalog: profile systems & components ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_profile_systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  brand text,
  series text,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mfg_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  hex_code text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mfg_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_system_id uuid REFERENCES public.mfg_profile_systems(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN (
    'profile_frame','profile_sash','profile_mullion','profile_bead',
    'steel','glass','hardware','accessory','labor','transport','waste','other'
  )),
  name text NOT NULL,
  sku text,
  unit text NOT NULL DEFAULT 'م',
  length_mm numeric,
  waste_percent numeric NOT NULL DEFAULT 5,
  buy_price numeric NOT NULL DEFAULT 0,
  sell_price numeric NOT NULL DEFAULT 0,
  formula_key text,
  is_active boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfg_components_kind_idx ON public.mfg_components(kind);
CREATE INDEX IF NOT EXISTS mfg_components_system_idx ON public.mfg_components(profile_system_id);

-- ─── Production stages & QC templates ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  requires_qc boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mfg_qc_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid REFERENCES public.mfg_stages(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_final boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mfg_qc_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.mfg_qc_templates(id) ON DELETE CASCADE,
  label text NOT NULL,
  field_type text NOT NULL DEFAULT 'pass_fail'
    CHECK (field_type IN ('pass_fail','measurement','text','photo')),
  is_critical boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  expected_hint text
);

-- ─── Projects / jobs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_number text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  title text NOT NULL,
  site_address text,
  building text,
  floor text,
  apartment text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','survey','tech_review','quotation','approved','materials',
    'production','qc','ready','delivery','installation','closed','cancelled'
  )),
  survey_date date,
  due_date date,
  delivery_date date,
  notes text,
  profit_margin_percent numeric NOT NULL DEFAULT 25,
  discount_amount numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  estimated_cost numeric NOT NULL DEFAULT 0,
  estimated_price numeric NOT NULL DEFAULT 0,
  actual_cost numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  approved_revision_id uuid,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfg_projects_customer_idx ON public.mfg_projects(customer_id);
CREATE INDEX IF NOT EXISTS mfg_projects_status_idx ON public.mfg_projects(status);

CREATE TABLE IF NOT EXISTS public.mfg_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mfg_projects(id) ON DELETE CASCADE,
  unit_code text NOT NULL,
  qr_token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  location_label text,
  unit_type text NOT NULL DEFAULT 'window' CHECK (unit_type IN (
    'window','door','fixed','sliding','casement','tilt','custom'
  )),
  width_mm numeric NOT NULL DEFAULT 0,
  height_mm numeric NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1,
  profile_system_id uuid REFERENCES public.mfg_profile_systems(id) ON DELETE SET NULL,
  color_id uuid REFERENCES public.mfg_colors(id) ON DELETE SET NULL,
  glass_spec text,
  hardware_spec text,
  opening_direction text,
  has_mosquito_net boolean NOT NULL DEFAULT false,
  has_roller_shutter boolean NOT NULL DEFAULT false,
  geometry jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, unit_code)
);

CREATE INDEX IF NOT EXISTS mfg_units_project_idx ON public.mfg_units(project_id);
CREATE INDEX IF NOT EXISTS mfg_units_qr_idx ON public.mfg_units(qr_token);

CREATE TABLE IF NOT EXISTS public.mfg_design_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mfg_projects(id) ON DELETE CASCADE,
  revision_number integer NOT NULL DEFAULT 1,
  label text,
  geometry_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_approved boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision_number)
);

ALTER TABLE public.mfg_projects
  DROP CONSTRAINT IF EXISTS mfg_projects_approved_revision_id_fkey;
ALTER TABLE public.mfg_projects
  ADD CONSTRAINT mfg_projects_approved_revision_id_fkey
  FOREIGN KEY (approved_revision_id) REFERENCES public.mfg_design_revisions(id) ON DELETE SET NULL;

-- ─── Quotations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mfg_projects(id) ON DELETE CASCADE,
  quote_number text NOT NULL UNIQUE,
  revision_id uuid REFERENCES public.mfg_design_revisions(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'draft' CHECK (stage IN (
    'draft','sent','approved','rejected','cancelled','converted'
  )),
  subtotal_cost numeric NOT NULL DEFAULT 0,
  subtotal_price numeric NOT NULL DEFAULT 0,
  margin_percent numeric NOT NULL DEFAULT 25,
  discount_amount numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  valid_until date,
  notes text,
  pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mfg_quotation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.mfg_quotations(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.mfg_units(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_cost numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ─── BOM / materials ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_bom_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mfg_projects(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.mfg_units(id) ON DELETE SET NULL,
  component_id uuid REFERENCES public.mfg_components(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  kind text NOT NULL,
  description text NOT NULL,
  unit text NOT NULL DEFAULT 'قطعة',
  required_qty numeric NOT NULL DEFAULT 0,
  reserved_qty numeric NOT NULL DEFAULT 0,
  issued_qty numeric NOT NULL DEFAULT 0,
  purchased_qty numeric NOT NULL DEFAULT 0,
  waste_qty numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'stock' CHECK (source IN ('stock','purchase','mixed')),
  cut_length_mm numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfg_bom_project_idx ON public.mfg_bom_lines(project_id);

CREATE TABLE IF NOT EXISTS public.mfg_cut_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mfg_projects(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.mfg_units(id) ON DELETE SET NULL,
  bom_line_id uuid REFERENCES public.mfg_bom_lines(id) ON DELETE SET NULL,
  material_kind text NOT NULL DEFAULT 'profile',
  label text NOT NULL,
  length_mm numeric NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  angle_left numeric DEFAULT 45,
  angle_right numeric DEFAULT 45,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.mfg_material_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mfg_projects(id) ON DELETE CASCADE,
  request_number text NOT NULL UNIQUE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','ordered','partial','received','cancelled'
  )),
  notes text,
  total_cost numeric NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mfg_material_request_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.mfg_material_requests(id) ON DELETE CASCADE,
  bom_line_id uuid REFERENCES public.mfg_bom_lines(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  received_qty numeric NOT NULL DEFAULT 0
);

-- ─── Production tracking ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_unit_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.mfg_units(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.mfg_stages(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','in_progress','done','blocked','skipped'
  )),
  started_at timestamptz,
  finished_at timestamptz,
  worker_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  UNIQUE (unit_id, stage_id)
);

CREATE INDEX IF NOT EXISTS mfg_unit_stages_status_idx ON public.mfg_unit_stages(status);

-- ─── QC ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_qc_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.mfg_units(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.mfg_qc_templates(id) ON DELETE SET NULL,
  stage_id uuid REFERENCES public.mfg_stages(id) ON DELETE SET NULL,
  result text NOT NULL DEFAULT 'pending' CHECK (result IN (
    'pending','pass','fail','conditional'
  )),
  inspector_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  inspected_at timestamptz,
  notes text,
  signature_name text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mfg_qc_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.mfg_qc_inspections(id) ON DELETE CASCADE,
  checklist_item_id uuid REFERENCES public.mfg_qc_checklist_items(id) ON DELETE SET NULL,
  label text NOT NULL,
  result text CHECK (result IN ('pass','fail','na','conditional')),
  measured_value text,
  notes text,
  is_critical boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.mfg_rework_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.mfg_units(id) ON DELETE CASCADE,
  inspection_id uuid REFERENCES public.mfg_qc_inspections(id) ON DELETE SET NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open','in_progress','done','cancelled'
  )),
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

-- ─── Delivery / installation ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mfg_projects(id) ON DELETE CASCADE,
  delivery_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned','loaded','delivered','partial','cancelled'
  )),
  scheduled_at timestamptz,
  delivered_at timestamptz,
  driver_name text,
  vehicle_info text,
  recipient_name text,
  recipient_signature text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mfg_delivery_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES public.mfg_deliveries(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.mfg_units(id) ON DELETE CASCADE,
  UNIQUE (delivery_id, unit_id)
);

CREATE TABLE IF NOT EXISTS public.mfg_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mfg_projects(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.mfg_units(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned','in_progress','done','issue','cancelled'
  )),
  scheduled_at timestamptz,
  completed_at timestamptz,
  technician_name text,
  handover_signed_by text,
  notes text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mfg_warranty_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mfg_projects(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.mfg_units(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open','in_progress','resolved','closed'
  )),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

-- ─── Project finance extras ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_project_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mfg_projects(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  safe_transaction_id uuid,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mfg_project_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mfg_projects(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  method text NOT NULL DEFAULT 'cash',
  party_payment_id uuid,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Sequences reuse public.document_sequences (kind, period, last_value)
-- via mfg_next_number RPC below.

-- ─── Seed stages ────────────────────────────────────────────────────────────
INSERT INTO public.mfg_stages (code, name, sort_order, requires_qc)
VALUES
  ('tech_review', 'مراجعة فنية', 10, true),
  ('cutting', 'تقطيع القطاعات والحديد', 20, true),
  ('milling', 'تفريز وفتحات التصريف', 30, false),
  ('steel', 'تركيب الحديد', 40, true),
  ('welding', 'لحام', 50, true),
  ('cleaning', 'تنظيف الزوايا', 60, false),
  ('hardware', 'تركيب الإكسسوارات', 70, true),
  ('glazing', 'تزجيج وتجميع', 80, true),
  ('final_qc', 'فحص نهائي وتغليف', 90, true)
ON CONFLICT (code) DO NOTHING;

-- Seed final QC template + items (idempotent-ish)
DO $$
DECLARE
  v_stage uuid;
  v_tpl uuid;
BEGIN
  SELECT id INTO v_stage FROM public.mfg_stages WHERE code = 'final_qc' LIMIT 1;
  IF v_stage IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.mfg_qc_templates WHERE stage_id = v_stage AND is_final) THEN
    RETURN;
  END IF;
  INSERT INTO public.mfg_qc_templates (stage_id, name, is_final)
  VALUES (v_stage, 'ورقة مطابقة نهائية', true)
  RETURNING id INTO v_tpl;

  INSERT INTO public.mfg_qc_checklist_items (template_id, label, field_type, is_critical, sort_order, expected_hint)
  VALUES
    (v_tpl, 'مطابقة القطاع واللون', 'pass_fail', true, 10, 'حسب التصميم المعتمد'),
    (v_tpl, 'أبعاد الإطار والأقطار', 'measurement', true, 20, 'مم'),
    (v_tpl, 'جودة اللحام والزوايا', 'pass_fail', true, 30, NULL),
    (v_tpl, 'الحديد والتثبيت', 'pass_fail', true, 40, NULL),
    (v_tpl, 'الزجاج والجوانات والبلوكات', 'pass_fail', true, 50, NULL),
    (v_tpl, 'الإكسسوارات والفتح والغلق', 'pass_fail', true, 60, NULL),
    (v_tpl, 'التصريف وعدم التسريب', 'pass_fail', true, 70, NULL),
    (v_tpl, 'المظهر النهائي والخدوش', 'pass_fail', false, 80, NULL),
    (v_tpl, 'ملاحظات المراجع', 'text', false, 90, NULL);
END $$;

-- Seed default colors
INSERT INTO public.mfg_colors (name, hex_code, sort_order)
SELECT * FROM (VALUES
  ('أبيض', '#FFFFFF', 1),
  ('بني', '#5C4033', 2),
  ('رمادي', '#808080', 3),
  ('أسود', '#1A1A1A', 4),
  ('ذهبي بلوط', '#C4A35A', 5)
) AS v(name, hex_code, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.mfg_colors LIMIT 1);

-- Seed a default profile system
INSERT INTO public.mfg_profile_systems (name, brand, series, description, sort_order)
SELECT 'نظام قياسي 60', 'عام', '60mm', 'نظام افتراضي للشبابيك والأبواب', 1
WHERE NOT EXISTS (SELECT 1 FROM public.mfg_profile_systems LIMIT 1);

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.mfg_profile_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_qc_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_qc_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_design_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_quotation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_cut_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_material_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_material_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_unit_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_qc_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_qc_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_rework_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_delivery_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_warranty_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_project_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfg_project_payments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mfg_profile_systems','mfg_colors','mfg_components','mfg_stages','mfg_qc_templates',
    'mfg_qc_checklist_items','mfg_projects','mfg_units','mfg_design_revisions',
    'mfg_quotations','mfg_quotation_lines','mfg_bom_lines','mfg_cut_list',
    'mfg_material_requests','mfg_material_request_lines','mfg_unit_stages',
    'mfg_qc_inspections','mfg_qc_results','mfg_rework_orders','mfg_deliveries',
    'mfg_delivery_units','mfg_installations','mfg_warranty_tickets',
    'mfg_project_expenses','mfg_project_payments'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (public.has_app_permission(''manufacturing''))',
      t, t
    );
  END LOOP;
END $$;

-- Write policies (catalog)
DROP POLICY IF EXISTS mfg_catalog_write ON public.mfg_profile_systems;
CREATE POLICY mfg_catalog_write ON public.mfg_profile_systems FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.catalog'))
  WITH CHECK (public.has_app_permission('manufacturing.catalog'));
DROP POLICY IF EXISTS mfg_colors_write ON public.mfg_colors;
CREATE POLICY mfg_colors_write ON public.mfg_colors FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.catalog'))
  WITH CHECK (public.has_app_permission('manufacturing.catalog'));
DROP POLICY IF EXISTS mfg_components_write ON public.mfg_components;
CREATE POLICY mfg_components_write ON public.mfg_components FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.catalog'))
  WITH CHECK (public.has_app_permission('manufacturing.catalog'));

DROP POLICY IF EXISTS mfg_stages_write ON public.mfg_stages;
CREATE POLICY mfg_stages_write ON public.mfg_stages FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.catalog'))
  WITH CHECK (public.has_app_permission('manufacturing.catalog'));
DROP POLICY IF EXISTS mfg_qc_tpl_write ON public.mfg_qc_templates;
CREATE POLICY mfg_qc_tpl_write ON public.mfg_qc_templates FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.catalog'))
  WITH CHECK (public.has_app_permission('manufacturing.catalog'));
DROP POLICY IF EXISTS mfg_qc_items_write ON public.mfg_qc_checklist_items;
CREATE POLICY mfg_qc_items_write ON public.mfg_qc_checklist_items FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.catalog'))
  WITH CHECK (public.has_app_permission('manufacturing.catalog'));

-- Project write
DROP POLICY IF EXISTS mfg_projects_write ON public.mfg_projects;
CREATE POLICY mfg_projects_write ON public.mfg_projects FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.write') OR public.has_app_permission('manufacturing.approve'))
  WITH CHECK (public.has_app_permission('manufacturing.write') OR public.has_app_permission('manufacturing.approve'));

DROP POLICY IF EXISTS mfg_units_write ON public.mfg_units;
CREATE POLICY mfg_units_write ON public.mfg_units FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.write'))
  WITH CHECK (public.has_app_permission('manufacturing.write'));

DROP POLICY IF EXISTS mfg_revisions_write ON public.mfg_design_revisions;
CREATE POLICY mfg_revisions_write ON public.mfg_design_revisions FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.write') OR public.has_app_permission('manufacturing.approve'))
  WITH CHECK (public.has_app_permission('manufacturing.write') OR public.has_app_permission('manufacturing.approve'));

DROP POLICY IF EXISTS mfg_quotes_write ON public.mfg_quotations;
CREATE POLICY mfg_quotes_write ON public.mfg_quotations FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.write') OR public.has_app_permission('manufacturing.approve'))
  WITH CHECK (public.has_app_permission('manufacturing.write') OR public.has_app_permission('manufacturing.approve'));

DROP POLICY IF EXISTS mfg_quote_lines_write ON public.mfg_quotation_lines;
CREATE POLICY mfg_quote_lines_write ON public.mfg_quotation_lines FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.write'))
  WITH CHECK (public.has_app_permission('manufacturing.write'));

DROP POLICY IF EXISTS mfg_bom_write ON public.mfg_bom_lines;
CREATE POLICY mfg_bom_write ON public.mfg_bom_lines FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.write') OR public.has_app_permission('manufacturing.produce'))
  WITH CHECK (public.has_app_permission('manufacturing.write') OR public.has_app_permission('manufacturing.produce'));

DROP POLICY IF EXISTS mfg_cut_write ON public.mfg_cut_list;
CREATE POLICY mfg_cut_write ON public.mfg_cut_list FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.write') OR public.has_app_permission('manufacturing.produce'))
  WITH CHECK (public.has_app_permission('manufacturing.write') OR public.has_app_permission('manufacturing.produce'));

DROP POLICY IF EXISTS mfg_mat_req_write ON public.mfg_material_requests;
CREATE POLICY mfg_mat_req_write ON public.mfg_material_requests FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.write'))
  WITH CHECK (public.has_app_permission('manufacturing.write'));

DROP POLICY IF EXISTS mfg_mat_req_lines_write ON public.mfg_material_request_lines;
CREATE POLICY mfg_mat_req_lines_write ON public.mfg_material_request_lines FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.write'))
  WITH CHECK (public.has_app_permission('manufacturing.write'));

DROP POLICY IF EXISTS mfg_unit_stages_write ON public.mfg_unit_stages;
CREATE POLICY mfg_unit_stages_write ON public.mfg_unit_stages FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.produce') OR public.has_app_permission('manufacturing.write'))
  WITH CHECK (public.has_app_permission('manufacturing.produce') OR public.has_app_permission('manufacturing.write'));

DROP POLICY IF EXISTS mfg_qc_insp_write ON public.mfg_qc_inspections;
CREATE POLICY mfg_qc_insp_write ON public.mfg_qc_inspections FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.qc'))
  WITH CHECK (public.has_app_permission('manufacturing.qc'));

DROP POLICY IF EXISTS mfg_qc_res_write ON public.mfg_qc_results;
CREATE POLICY mfg_qc_res_write ON public.mfg_qc_results FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.qc'))
  WITH CHECK (public.has_app_permission('manufacturing.qc'));

DROP POLICY IF EXISTS mfg_rework_write ON public.mfg_rework_orders;
CREATE POLICY mfg_rework_write ON public.mfg_rework_orders FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.qc') OR public.has_app_permission('manufacturing.produce'))
  WITH CHECK (public.has_app_permission('manufacturing.qc') OR public.has_app_permission('manufacturing.produce'));

DROP POLICY IF EXISTS mfg_del_write ON public.mfg_deliveries;
CREATE POLICY mfg_del_write ON public.mfg_deliveries FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.delivery'))
  WITH CHECK (public.has_app_permission('manufacturing.delivery'));

DROP POLICY IF EXISTS mfg_del_units_write ON public.mfg_delivery_units;
CREATE POLICY mfg_del_units_write ON public.mfg_delivery_units FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.delivery'))
  WITH CHECK (public.has_app_permission('manufacturing.delivery'));

DROP POLICY IF EXISTS mfg_inst_write ON public.mfg_installations;
CREATE POLICY mfg_inst_write ON public.mfg_installations FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.delivery'))
  WITH CHECK (public.has_app_permission('manufacturing.delivery'));

DROP POLICY IF EXISTS mfg_warranty_write ON public.mfg_warranty_tickets;
CREATE POLICY mfg_warranty_write ON public.mfg_warranty_tickets FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.write') OR public.has_app_permission('manufacturing.delivery'))
  WITH CHECK (public.has_app_permission('manufacturing.write') OR public.has_app_permission('manufacturing.delivery'));

DROP POLICY IF EXISTS mfg_exp_write ON public.mfg_project_expenses;
CREATE POLICY mfg_exp_write ON public.mfg_project_expenses FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.finance'))
  WITH CHECK (public.has_app_permission('manufacturing.finance'));

DROP POLICY IF EXISTS mfg_pay_write ON public.mfg_project_payments;
CREATE POLICY mfg_pay_write ON public.mfg_project_payments FOR ALL TO authenticated
  USING (public.has_app_permission('manufacturing.finance'))
  WITH CHECK (public.has_app_permission('manufacturing.finance'));

-- ─── RPCs ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mfg_next_number(p_doc_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text := lower(trim(p_doc_type));
  v_prefix text;
  v_period text;
  v_next bigint;
  v_pad int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF NOT public.has_app_permission('manufacturing') THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  v_prefix := CASE v_kind
    WHEN 'mfg_project' THEN 'MFG'
    WHEN 'mfg_quote' THEN 'MQ'
    WHEN 'mfg_material' THEN 'MM'
    WHEN 'mfg_delivery' THEN 'MD'
    ELSE NULL
  END;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'نوع مستند التصنيع غير صالح: %', p_doc_type;
  END IF;

  v_period := to_char((now() AT TIME ZONE 'Africa/Cairo'), 'YYMM');

  INSERT INTO public.document_sequences AS ds (kind, period, last_value)
  VALUES (v_kind, v_period, 1)
  ON CONFLICT (kind, period)
  DO UPDATE SET last_value = ds.last_value + 1
  RETURNING ds.last_value INTO v_next;

  v_pad := GREATEST(4, length(v_next::text));
  RETURN v_prefix || '-' || v_period || '-' || lpad(v_next::text, v_pad, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.mfg_transition_project(
  p_project_id uuid,
  p_to_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from text;
  v_allowed text[];
BEGIN
  IF NOT (
    public.has_app_permission('manufacturing.write')
    OR public.has_app_permission('manufacturing.approve')
    OR public.has_app_permission('manufacturing.produce')
    OR public.has_app_permission('manufacturing.qc')
    OR public.has_app_permission('manufacturing.delivery')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بتغيير حالة المشروع';
  END IF;

  SELECT status INTO v_from FROM public.mfg_projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;

  v_allowed := CASE v_from
    WHEN 'draft' THEN ARRAY['survey','cancelled']
    WHEN 'survey' THEN ARRAY['tech_review','draft','cancelled']
    WHEN 'tech_review' THEN ARRAY['quotation','survey','cancelled']
    WHEN 'quotation' THEN ARRAY['approved','tech_review','cancelled']
    WHEN 'approved' THEN ARRAY['materials','quotation','cancelled']
    WHEN 'materials' THEN ARRAY['production','approved','cancelled']
    WHEN 'production' THEN ARRAY['qc','materials','cancelled']
    WHEN 'qc' THEN ARRAY['ready','production','cancelled']
    WHEN 'ready' THEN ARRAY['delivery','qc','cancelled']
    WHEN 'delivery' THEN ARRAY['installation','ready','closed','cancelled']
    WHEN 'installation' THEN ARRAY['closed','delivery','cancelled']
    WHEN 'closed' THEN ARRAY[]::text[]
    WHEN 'cancelled' THEN ARRAY['draft']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_to_status = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'انتقال غير مسموح من % إلى %', v_from, p_to_status;
  END IF;

  IF p_to_status = 'approved' AND NOT public.has_app_permission('manufacturing.approve') THEN
    RAISE EXCEPTION 'اعتماد العرض يتطلب صلاحية الاعتماد';
  END IF;

  UPDATE public.mfg_projects
  SET status = p_to_status, updated_at = now()
  WHERE id = p_project_id;

  RETURN jsonb_build_object('id', p_project_id, 'from', v_from, 'to', p_to_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.mfg_issue_stock_for_project(
  p_project_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  line jsonb;
  v_bom uuid;
  v_product uuid;
  v_qty numeric;
  v_avail numeric;
  v_issued numeric := 0;
BEGIN
  IF NOT (
    public.has_app_permission('manufacturing.write')
    OR public.has_app_permission('manufacturing.produce')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بصرف المخزون';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'بنود الصرف غير صالحة';
  END IF;

  FOR line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_bom := (line->>'bom_line_id')::uuid;
    v_product := (line->>'product_id')::uuid;
    v_qty := COALESCE((line->>'qty')::numeric, 0);
    IF v_bom IS NULL OR v_product IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT quantity INTO v_avail FROM public.products WHERE id = v_product FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الصنف غير موجود';
    END IF;
    IF COALESCE(v_avail, 0) < v_qty THEN
      RAISE EXCEPTION 'الكمية غير كافية للصنف %', v_product;
    END IF;

    UPDATE public.products
    SET quantity = quantity - v_qty, updated_at = now()
    WHERE id = v_product;

    UPDATE public.mfg_bom_lines
    SET issued_qty = COALESCE(issued_qty, 0) + v_qty,
        reserved_qty = GREATEST(0, COALESCE(reserved_qty, 0) - v_qty),
        source = CASE
          WHEN COALESCE(purchased_qty, 0) > 0 THEN 'mixed'
          ELSE 'stock'
        END
    WHERE id = v_bom AND project_id = p_project_id;

    v_issued := v_issued + v_qty;
  END LOOP;

  UPDATE public.mfg_projects
  SET actual_cost = (
    SELECT COALESCE(SUM(COALESCE(issued_qty,0) * COALESCE(unit_cost,0)
      + COALESCE(purchased_qty,0) * COALESCE(unit_cost,0)), 0)
    FROM public.mfg_bom_lines WHERE project_id = p_project_id
  ) + COALESCE((
    SELECT SUM(amount) FROM public.mfg_project_expenses WHERE project_id = p_project_id
  ), 0),
  updated_at = now()
  WHERE id = p_project_id;

  RETURN jsonb_build_object('project_id', p_project_id, 'issued_qty', v_issued);
END;
$$;

CREATE OR REPLACE FUNCTION public.mfg_init_unit_stages(p_unit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_app_permission('manufacturing.write')
    OR public.has_app_permission('manufacturing.produce')
  ) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  INSERT INTO public.mfg_unit_stages (unit_id, stage_id, status)
  SELECT p_unit_id, s.id, 'pending'
  FROM public.mfg_stages s
  WHERE s.is_active
  ON CONFLICT (unit_id, stage_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.mfg_set_unit_stage(
  p_unit_id uuid,
  p_stage_code text,
  p_status text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage uuid;
  v_row public.mfg_unit_stages%ROWTYPE;
BEGIN
  IF NOT (
    public.has_app_permission('manufacturing.produce')
    OR public.has_app_permission('manufacturing.write')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بتحديث المرحلة';
  END IF;

  SELECT id INTO v_stage FROM public.mfg_stages WHERE code = p_stage_code;
  IF v_stage IS NULL THEN RAISE EXCEPTION 'مرحلة غير معروفة'; END IF;

  PERFORM public.mfg_init_unit_stages(p_unit_id);

  UPDATE public.mfg_unit_stages
  SET
    status = p_status,
    notes = COALESCE(p_notes, notes),
    worker_id = auth.uid(),
    started_at = CASE
      WHEN p_status = 'in_progress' AND started_at IS NULL THEN now()
      ELSE started_at
    END,
    finished_at = CASE
      WHEN p_status IN ('done','skipped') THEN now()
      ELSE NULL
    END
  WHERE unit_id = p_unit_id AND stage_id = v_stage
  RETURNING * INTO v_row;

  UPDATE public.mfg_units SET status = p_stage_code || ':' || p_status, updated_at = now()
  WHERE id = p_unit_id;

  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mfg_next_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfg_transition_project(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfg_issue_stock_for_project(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfg_init_unit_stages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfg_set_unit_stage(uuid, text, text, text) TO authenticated;
