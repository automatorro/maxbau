-- user_roles: restrict INSERT/DELETE/UPDATE to admins
CREATE POLICY "Admins can manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- app_config: restrict reads to admins
DROP POLICY IF EXISTS "Authenticated users can read config" ON public.app_config;
CREATE POLICY "Admins can read config"
ON public.app_config
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- price_sheet_items: remove permissive write policies (admin ALL policy already exists)
DROP POLICY IF EXISTS "Authenticated users can delete price sheet items" ON public.price_sheet_items;
DROP POLICY IF EXISTS "Authenticated users can insert price sheet items" ON public.price_sheet_items;
DROP POLICY IF EXISTS "Authenticated users can update price sheet items" ON public.price_sheet_items;

-- imports storage bucket policies
CREATE POLICY "Authenticated can read imports"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'imports');

CREATE POLICY "Users can upload own imports"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'imports' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Users can update own imports"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'imports' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')))
WITH CHECK (bucket_id = 'imports' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Users can delete own imports"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'imports' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')));