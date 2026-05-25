
-- Adaugă supplier_id pe products (FK → suppliers)
-- EXECUTAT MANUAL în editorul SQL Lovable pe 2026-05-05

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_supplier ON public.products(supplier_id);
