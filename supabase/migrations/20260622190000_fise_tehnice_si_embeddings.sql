-- ═══════════════════════════════════════════════════════════════════
-- Migrație: Suport complet pentru fișe tehnice + căutare vectorială
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Activare pgvector (dacă nu e activ) ──────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── 2. Câmpuri noi în products ──────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS fisa_tehnica_url           TEXT,
  ADD COLUMN IF NOT EXISTS fisa_tehnica_storage_path  TEXT,
  ADD COLUMN IF NOT EXISTS fisa_tehnica_processed     BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.products.fisa_tehnica_url IS
  'URL public al fișei tehnice PDF (cdn.contentspeed.ro)';
COMMENT ON COLUMN public.products.fisa_tehnica_storage_path IS
  'Calea în Supabase Storage (bucket fise-tehnice): {cod_intern}/{filename}.pdf';
COMMENT ON COLUMN public.products.fisa_tehnica_processed IS
  'True dacă specs AI au fost extrase din fișa tehnică';

-- ─── 3. Tabel log scraping ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fise_tehnice_scrape_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_url     TEXT NOT NULL UNIQUE,
  cod_intern      TEXT,
  fisa_tehnica_url TEXT,
  storage_path    TEXT,
  scraped_at      TIMESTAMPTZ DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  status          TEXT DEFAULT 'found',
  -- 'found' | 'not_found' | 'error' | 'specs_extracted'
  CONSTRAINT fk_log_product
    FOREIGN KEY (cod_intern)
    REFERENCES public.products(cod_intern)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_scrape_log_cod_intern
  ON public.fise_tehnice_scrape_log(cod_intern);
CREATE INDEX IF NOT EXISTS idx_scrape_log_status
  ON public.fise_tehnice_scrape_log(status);

-- RLS: admins pot vedea tot, script-ul scraper folosește service role (bypass RLS)
ALTER TABLE public.fise_tehnice_scrape_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage scrape log"
  ON public.fise_tehnice_scrape_log FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ─── 4. Tabel embeddings vectoriale ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  embedding   vector(768),   -- Gemini text-embedding-004: 768 dimensiuni
  specs_text  TEXT,          -- textul sursă folosit pentru embedding
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(product_id)
);

-- Index IVFFlat pentru cosine similarity (optim pentru >1000 vectori)
CREATE INDEX IF NOT EXISTS idx_product_embeddings_cosine
  ON public.product_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

ALTER TABLE public.product_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read embeddings"
  ON public.product_embeddings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage embeddings"
  ON public.product_embeddings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ─── 5. RPC: căutare semantică după specs tehnice ────────────────
--
-- Apelat din edge function ai-consultant cu query-ul clientului
-- transformat în embedding de Gemini.
--
CREATE OR REPLACE FUNCTION public.search_products_by_embedding(
  query_embedding   vector(768),
  match_threshold   FLOAT    DEFAULT 0.7,
  match_count       INT      DEFAULT 10,
  category_filter   TEXT     DEFAULT NULL  -- slug categorie opțional
)
RETURNS TABLE (
  product_id        UUID,
  cod_intern        TEXT,
  denumire_completa TEXT,
  brand             TEXT,
  fisa_tehnica_url  TEXT,
  specs_text        TEXT,
  specifications    JSONB,
  similarity        FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.cod_intern,
    p.denumire_completa,
    p.brand,
    p.fisa_tehnica_url,
    pe.specs_text,
    p.specifications,
    1 - (pe.embedding <=> query_embedding) AS similarity
  FROM public.product_embeddings pe
  JOIN public.products p ON p.id = pe.product_id
  WHERE
    p.is_active = true
    AND (category_filter IS NULL OR EXISTS (
      SELECT 1 FROM public.categories c
      WHERE c.id = p.category_id AND c.slug ILIKE '%' || category_filter || '%'
    ))
    AND 1 - (pe.embedding <=> query_embedding) >= match_threshold
  ORDER BY pe.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.search_products_by_embedding TO authenticated;

-- ─── 6. RPC: statistici fișe tehnice (pentru dashboard admin) ────
CREATE OR REPLACE FUNCTION public.get_fise_tehnice_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_products',         (SELECT COUNT(*) FROM public.products WHERE is_active = true),
    'with_fisa_url',          (SELECT COUNT(*) FROM public.products WHERE fisa_tehnica_url IS NOT NULL),
    'with_specs_extracted',   (SELECT COUNT(*) FROM public.products WHERE fisa_tehnica_processed = true),
    'with_embeddings',        (SELECT COUNT(*) FROM public.product_embeddings),
    'scrape_log', jsonb_build_object(
      'found',          (SELECT COUNT(*) FROM public.fise_tehnice_scrape_log WHERE status = 'found'),
      'not_found',      (SELECT COUNT(*) FROM public.fise_tehnice_scrape_log WHERE status = 'not_found'),
      'specs_extracted',(SELECT COUNT(*) FROM public.fise_tehnice_scrape_log WHERE status = 'specs_extracted'),
      'error',          (SELECT COUNT(*) FROM public.fise_tehnice_scrape_log WHERE status = 'error')
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_fise_tehnice_stats TO authenticated;
