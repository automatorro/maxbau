-- Add variant_name to quote_items to allow multi-variant quotes
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS variant_name TEXT DEFAULT 'Varianta Standard';

COMMENT ON COLUMN public.quote_items.variant_name IS 'Numele variantei de ofertare din care face parte produsul, ex: "Varianta Standard" sau "Varianta Premium"';
