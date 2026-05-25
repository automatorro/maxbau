-- Creare tabel pentru prețuri, grile și istoric
CREATE TABLE IF NOT EXISTS public.product_prices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    price_type TEXT NOT NULL DEFAULT 'Preț listă',
    price NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RON',
    min_quantity NUMERIC DEFAULT 1,
    unit TEXT,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_to TIMESTAMPTZ, -- Dacă e NULL, înseamnă că e prețul activ curent
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexuri pentru performanță la interogările curente
CREATE INDEX IF NOT EXISTS idx_product_prices_active ON public.product_prices(product_id, supplier_id, valid_to) WHERE valid_to IS NULL;

-- Activare Row Level Security
ALTER TABLE public.product_prices ENABLE ROW LEVEL SECURITY;

-- Politici de acces (exemplu standard, poate fi ajustat în funcție de roluri)
CREATE POLICY "Permite vizualizarea prețurilor pentru utilizatorii autentificați" 
ON public.product_prices FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Permite inserarea prețurilor pentru utilizatorii autentificați" 
ON public.product_prices FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "Permite actualizarea prețurilor pentru utilizatorii autentificați" 
ON public.product_prices FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "Permite ștergerea prețurilor pentru utilizatorii autentificați" 
ON public.product_prices FOR DELETE 
TO authenticated 
USING (true);
