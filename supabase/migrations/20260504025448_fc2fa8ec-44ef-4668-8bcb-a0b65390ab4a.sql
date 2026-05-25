
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.echivalente_produse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cerere_text text NOT NULL,
  product_id uuid NOT NULL,
  cod_intern text,
  denumire_completa text,
  pret_lista numeric,
  unit text,
  scor_relevanta numeric DEFAULT 0,
  nota_echivalenta text,
  category_id uuid,
  category_path text,
  creat_de uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_echivalente_cerere ON public.echivalente_produse USING gin (cerere_text gin_trgm_ops);
CREATE INDEX idx_echivalente_product ON public.echivalente_produse (product_id);

ALTER TABLE public.echivalente_produse ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view equivalences"
  ON public.echivalente_produse FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert equivalences"
  ON public.echivalente_produse FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can manage equivalences"
  ON public.echivalente_produse FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
