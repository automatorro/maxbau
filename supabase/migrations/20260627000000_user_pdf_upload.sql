-- ═══════════════════════════════════════════════════════════════════
-- Migrație: Permisiuni upload fișe tehnice pentru orice utilizator
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Asigurare bucket storage 'fise-tehnice' ──────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('fise-tehnice', 'fise-tehnice', true)
ON CONFLICT (id) DO NOTHING;

-- RLS pe storage.objects pentru bucket-ul 'fise-tehnice'
CREATE POLICY "Utilizatorii autentificati pot incarca fise tehnice" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fise-tehnice');

CREATE POLICY "Utilizatorii autentificati pot actualiza fise tehnice" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'fise-tehnice')
  WITH CHECK (bucket_id = 'fise-tehnice');

CREATE POLICY "Oricine poate citi fisele tehnice" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'fise-tehnice');

-- ─── 2. Tabel pdf_extraction_log pentru rate limiting ───────────
CREATE TABLE IF NOT EXISTS public.pdf_extraction_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pentru numararea rapida a extragerilor zilnice per user
CREATE INDEX IF NOT EXISTS idx_pdf_extraction_log_user_date
  ON public.pdf_extraction_log (user_id, created_at);

-- RLS pe pdf_extraction_log
ALTER TABLE public.pdf_extraction_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Utilizatorii pot vedea propriul log de extrageri" ON public.pdf_extraction_log
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Utilizatorii pot insera in propriul log de extrageri" ON public.pdf_extraction_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ─── 3. Permisiuni de update pe products pentru fisa_tehnica ─────
-- Permitem utilizatorilor autentificati sa poata actualiza URL-ul si calea PDF-ului pentru produse
CREATE POLICY "Utilizatorii autentificati pot actualiza fisele tehnice din produse" ON public.products
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
