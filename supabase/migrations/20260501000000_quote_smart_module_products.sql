-- Faza 1a: Extindere tabel products cu câmpuri pentru modulul de ofertare inteligentă
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS consum TEXT,
  ADD COLUMN IF NOT EXISTS ambalare TEXT,
  ADD COLUMN IF NOT EXISTS similar_cu TEXT,
  ADD COLUMN IF NOT EXISTS caracteristici JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.products.consum IS 'Consum orientativ, ex: "3-4 kg/m²" sau "0.2 L/m²"';
COMMENT ON COLUMN public.products.ambalare IS 'Ambalaj produs, ex: "sac 25 kg" sau "găleată 5 L"';
COMMENT ON COLUMN public.products.similar_cu IS 'Produse similare de alte branduri, ex: "Mapei Keraflex S2, Baumit FlexMörtel"';
COMMENT ON COLUMN public.products.caracteristici IS 'Caracteristici tehnice structurate: {"clasa": "C2T", "standard": "EN 12004", "flexibil": true, "tip": "adeziv"}';

-- Index GIN pentru căutare eficientă în caracteristici JSONB
CREATE INDEX IF NOT EXISTS idx_products_caracteristici ON public.products USING GIN (caracteristici);

-- Index pentru similar_cu (full-text search)
CREATE INDEX IF NOT EXISTS idx_products_similar_cu ON public.products USING GIN (to_tsvector('romanian', COALESCE(similar_cu, '')));

-- Activare pg_trgm pentru fuzzy search pe denumire + similar_cu
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_products_denumire_trgm ON public.products USING GIN (denumire_completa gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_similar_trgm ON public.products USING GIN (COALESCE(similar_cu, '') gin_trgm_ops);
