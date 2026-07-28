-- Drop UPVC manufacturing module from store DB (moved to workshop-system).
-- Also restore effective_permissions without manufacturing / programs keys.

DROP FUNCTION IF EXISTS public.mfg_set_unit_stage(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.mfg_init_unit_stages(uuid);
DROP FUNCTION IF EXISTS public.mfg_issue_stock_for_project(uuid, jsonb);
DROP FUNCTION IF EXISTS public.mfg_transition_project(uuid, text);
DROP FUNCTION IF EXISTS public.mfg_next_number(text);

DROP TABLE IF EXISTS public.mfg_project_payments CASCADE;
DROP TABLE IF EXISTS public.mfg_project_expenses CASCADE;
DROP TABLE IF EXISTS public.mfg_warranty_tickets CASCADE;
DROP TABLE IF EXISTS public.mfg_installations CASCADE;
DROP TABLE IF EXISTS public.mfg_delivery_units CASCADE;
DROP TABLE IF EXISTS public.mfg_deliveries CASCADE;
DROP TABLE IF EXISTS public.mfg_rework_orders CASCADE;
DROP TABLE IF EXISTS public.mfg_qc_results CASCADE;
DROP TABLE IF EXISTS public.mfg_qc_inspections CASCADE;
DROP TABLE IF EXISTS public.mfg_unit_stages CASCADE;
DROP TABLE IF EXISTS public.mfg_material_request_lines CASCADE;
DROP TABLE IF EXISTS public.mfg_material_requests CASCADE;
DROP TABLE IF EXISTS public.mfg_cut_list CASCADE;
DROP TABLE IF EXISTS public.mfg_bom_lines CASCADE;
DROP TABLE IF EXISTS public.mfg_quotation_lines CASCADE;
DROP TABLE IF EXISTS public.mfg_quotations CASCADE;
DROP TABLE IF EXISTS public.mfg_design_revisions CASCADE;
DROP TABLE IF EXISTS public.mfg_units CASCADE;
DROP TABLE IF EXISTS public.mfg_projects CASCADE;
DROP TABLE IF EXISTS public.mfg_qc_checklist_items CASCADE;
DROP TABLE IF EXISTS public.mfg_qc_templates CASCADE;
DROP TABLE IF EXISTS public.mfg_stages CASCADE;
DROP TABLE IF EXISTS public.mfg_components CASCADE;
DROP TABLE IF EXISTS public.mfg_colors CASCADE;
DROP TABLE IF EXISTS public.mfg_profile_systems CASCADE;

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
      'shifts','audit'
    ];
  ELSIF p_role = 'manager' THEN
    RETURN ARRAY[
      'dashboard','pos','sales','purchases','products','products.write','inventory',
      'customers','customers.write','suppliers','treasury','expenses','reports','prices.edit',
      'shifts','settings','audit'
    ];
  ELSE
    RETURN ARRAY[
      'dashboard','pos','sales','products','inventory','customers','shifts'
    ];
  END IF;
END;
$$;
