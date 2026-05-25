
CREATE TABLE public.retete_constructii (
  id text PRIMARY KEY,
  recipe_name text NOT NULL,
  category text,
  unit text DEFAULT 'm²',
  materials jsonb NOT NULL,
  status text DEFAULT 'active',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.retete_constructii ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view recipes"
  ON public.retete_constructii FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage recipes"
  ON public.retete_constructii FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
