
-- Tabel suppliers (furnizori)
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  ai_column_map jsonb DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view suppliers"
  ON public.suppliers FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage suppliers"
  ON public.suppliers FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extensie price_sheets: supplier_id
ALTER TABLE public.price_sheets
  ADD COLUMN supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- Extensie price_sheet_items: coloane suplimentare furnizor
ALTER TABLE public.price_sheet_items
  ADD COLUMN cod_furnizor text,
  ADD COLUMN cantitate_palet text,
  ADD COLUMN consum text,
  ADD COLUMN extra_data jsonb DEFAULT '{}'::jsonb;
