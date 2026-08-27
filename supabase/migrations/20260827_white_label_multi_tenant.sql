-- ==============================================================================
-- Migrare Supabase: Multi-Tenant & White-Labeling Schema
-- Data generării: 27 August 2026
-- Scop: Suport pentru o singură bază de date cu mai multe companii (Tenants),
--       Catalog Master Shared (~4400 produse) + Produse Suplimentare per Companie
--       și personalizare vizuală/comercială per tenant.
-- ==============================================================================

-- 1. Tabelă Companii / Distribuitori (Tenants)
CREATE TABLE IF NOT EXISTS public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE NOT NULL,
  logo_url TEXT,
  primary_color VARCHAR DEFAULT '#f97316', -- Culoare primară (HEX/HSL)
  accent_color VARCHAR DEFAULT '#1e293b',  -- Culoare accent (HEX/HSL)
  company_details JSONB DEFAULT '{}'::jsonb, -- CUI, RegCom, Adresă, Bancă, IBAN, Telefon, Email
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Inserare Tenant Implicit (pentru compatibilitate cu datele existente)
INSERT INTO public.tenants (id, name, slug, company_details)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Sales Dashboard Default',
  'default',
  '{"cui": "RO00000000", "reg_com": "J00/000/2026", "address": "România"}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- 2. Extindere tabelă `products` pentru Produse Suplimentare per Companie
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT true;

-- Comentarii explicative pe coloane
COMMENT ON COLUMN public.products.is_global IS 'True = produs din Catalogul Master Universal (accesibil tuturor companiilor). False = produs suplimentar adăugat de o companie specifică.';
COMMENT ON COLUMN public.products.tenant_id IS 'ID-ul companiei care a adăugat produsul (NULL pentru produsele din Catalogul Master Universal).';

-- 3. Tabelă de suprapunere prețuri și coduri interne per companie (Tenant Product Overlay)
CREATE TABLE IF NOT EXISTS public.tenant_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  cod_intern VARCHAR,
  pret_lista NUMERIC(12, 2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, product_id)
);

COMMENT ON TABLE public.tenant_products IS 'Stochează prețurile de listă și codurile interne specifice fiecărui distribuitor pentru produsele din catalogul universal.';

-- 4. Extindere tabele existente cu `tenant_id` pentru izolare date comerciale
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.grile_pret ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.discount_rules ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);

-- Setare tenant implicit pentru profilele și ofertele existente
UPDATE public.profiles SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE public.quotes SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- 5. Polici-uri RLS (Row Level Security) recomandate
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants read access" ON public.tenants
  FOR SELECT USING (true);

CREATE POLICY "Tenant products read access" ON public.tenant_products
  FOR SELECT USING (true);
