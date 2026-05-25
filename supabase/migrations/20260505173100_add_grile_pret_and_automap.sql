-- 1. Adaugă coloana grile_pret de tip JSONB pe tabelul products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS grile_pret jsonb DEFAULT '{}'::jsonb;

-- 2. Auto-mapare furnizori existenți pe baza denumirii produsului
-- Caută numele furnizorului (insensitiv la majuscule) în denumirea completă a produsului
-- și setează supplier_id dacă produsul nu are deja unul.
UPDATE public.products p
SET supplier_id = s.id
FROM public.suppliers s
WHERE p.denumire_completa ILIKE '%' || s.name || '%'
  AND p.supplier_id IS NULL;
