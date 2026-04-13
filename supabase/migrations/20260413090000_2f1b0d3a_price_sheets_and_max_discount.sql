CREATE TABLE public.price_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  source text,
  received_at date,
  active boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.price_sheet_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_sheet_id uuid NOT NULL REFERENCES public.price_sheets(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  label text,
  unit text,
  price numeric NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.quotes
ADD COLUMN max_discount_percent numeric;

ALTER TABLE public.price_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_sheet_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view price sheets"
  ON public.price_sheets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view price sheet items"
  ON public.price_sheet_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage price sheets"
  ON public.price_sheets FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage price sheet items"
  ON public.price_sheet_items FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
