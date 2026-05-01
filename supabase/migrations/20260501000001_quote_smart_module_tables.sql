-- Faza 1b: Tabele noi pentru modulul de ofertare inteligentă

-- Tabel cereri_clienti: stochează cererea brută a clientului
CREATE TABLE public.cereri_clienti (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  descriere_client TEXT NOT NULL,
  tip_produs TEXT,
  caracteristici_cerute JSONB DEFAULT '{}'::jsonb,
  cantitate NUMERIC(10,2),
  unitate TEXT,
  suprafata NUMERIC(10,2),
  quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cereri_clienti ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own cereri" ON public.cereri_clienti
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all cereri" ON public.cereri_clienti
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_cereri_clienti_user ON public.cereri_clienti(user_id);
CREATE INDEX idx_cereri_clienti_quote ON public.cereri_clienti(quote_id);

-- Tabel echivalente_produse: knowledge base de echivalențe curator-ate manual
CREATE TABLE public.echivalente_produse (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cerere_text TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  scor_relevanta INTEGER NOT NULL DEFAULT 100 CHECK (scor_relevanta BETWEEN 1 AND 100),
  nota_echivalenta TEXT,
  creat_de UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.echivalente_produse ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view echivalente" ON public.echivalente_produse
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage echivalente" ON public.echivalente_produse
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_echivalente_product ON public.echivalente_produse(product_id);
CREATE INDEX idx_echivalente_cerere_trgm ON public.echivalente_produse
  USING GIN (cerere_text gin_trgm_ops);

-- Adaugă coloana cerere_initiala în quote_items pentru a păstra contextul cererii originale
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS cerere_initiala TEXT,
  ADD COLUMN IF NOT EXISTS nota_echivalenta TEXT;

COMMENT ON COLUMN public.quote_items.cerere_initiala IS 'Cererea originală a clientului pentru acest produs, ex: "adeziv flexibil C2T EN 12004"';
COMMENT ON COLUMN public.quote_items.nota_echivalenta IS 'Nota de echivalență față de produsul cerut, ex: "Clasă superioară C2T, flexibilitate sporită"';
