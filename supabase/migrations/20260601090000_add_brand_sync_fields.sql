-- Adăugare câmpuri pentru sincronizare pe branduri
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS brand_slug TEXT;

COMMENT ON COLUMN public.products.is_active IS 'Produs activ pe site. False = a dispărut de pe maxbau.ro la ultima sincronizare.';
COMMENT ON COLUMN public.products.brand_slug IS 'Slug-ul brandului de pe maxbau.ro/marci/SLUG — ex: baumit, adeplast, alte-branduri';

-- Index pentru filtrare rapidă după brand_slug și is_active
CREATE INDEX IF NOT EXISTS idx_products_brand_slug ON public.products(brand_slug);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON public.products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products(brand);
