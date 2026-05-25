-- Migration: 20260525180000_security_fixes.sql
-- Fixes all Supabase Security Linter issues to allow the Lovable application to deploy and start securely.

-- ==========================================
-- 1. FIX: suppliers Table RLS Policies
-- ==========================================
DROP POLICY IF EXISTS "Authenticated users can view suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Admins can manage suppliers" ON public.suppliers;

CREATE POLICY "Authenticated users can view suppliers"
ON public.suppliers FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can insert suppliers"
ON public.suppliers FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update suppliers"
ON public.suppliers FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete suppliers"
ON public.suppliers FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ==========================================
-- 2. FIX: product_prices Table RLS Policies
-- ==========================================
DROP POLICY IF EXISTS "Permite vizualizarea prețurilor pentru utilizatorii autentificați" ON public.product_prices;
DROP POLICY IF EXISTS "Permite inserarea prețurilor pentru utilizatorii autentificați" ON public.product_prices;
DROP POLICY IF EXISTS "Permite actualizarea prețurilor pentru utilizatorii autentificați" ON public.product_prices;
DROP POLICY IF EXISTS "Permite ștergerea prețurilor pentru utilizatorii autentificați" ON public.product_prices;
DROP POLICY IF EXISTS "Authenticated users can view product prices" ON public.product_prices;
DROP POLICY IF EXISTS "Admins can insert product prices" ON public.product_prices;
DROP POLICY IF EXISTS "Admins can update product prices" ON public.product_prices;
DROP POLICY IF EXISTS "Admins can delete product prices" ON public.product_prices;

CREATE POLICY "Authenticated users can view product prices"
ON public.product_prices FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can insert product prices"
ON public.product_prices FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update product prices"
ON public.product_prices FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete product prices"
ON public.product_prices FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ==========================================
-- 3. FIX: price_sheets & price_sheet_items RLS Policies
-- ==========================================
-- price_sheets
DROP POLICY IF EXISTS "Authenticated users can view price sheets" ON public.price_sheets;
DROP POLICY IF EXISTS "Authenticated users can create price sheets" ON public.price_sheets;
DROP POLICY IF EXISTS "Admins can manage price sheets" ON public.price_sheets;
DROP POLICY IF EXISTS "Admins can create price sheets" ON public.price_sheets;
DROP POLICY IF EXISTS "Admins can update price sheets" ON public.price_sheets;
DROP POLICY IF EXISTS "Admins can delete price sheets" ON public.price_sheets;

CREATE POLICY "Authenticated users can view price sheets"
ON public.price_sheets FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can create price sheets"
ON public.price_sheets FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update price sheets"
ON public.price_sheets FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete price sheets"
ON public.price_sheets FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- price_sheet_items
DROP POLICY IF EXISTS "Authenticated users can view price sheet items" ON public.price_sheet_items;
DROP POLICY IF EXISTS "Authenticated users can insert price sheet items" ON public.price_sheet_items;
DROP POLICY IF EXISTS "Authenticated users can update price sheet items" ON public.price_sheet_items;
DROP POLICY IF EXISTS "Authenticated users can delete price sheet items" ON public.price_sheet_items;
DROP POLICY IF EXISTS "Admins can manage price sheet items" ON public.price_sheet_items;
DROP POLICY IF EXISTS "Admins can insert price sheet items" ON public.price_sheet_items;
DROP POLICY IF EXISTS "Admins can update price sheet items" ON public.price_sheet_items;
DROP POLICY IF EXISTS "Admins can delete price sheet items" ON public.price_sheet_items;

CREATE POLICY "Authenticated users can view price sheet items"
ON public.price_sheet_items FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can insert price sheet items"
ON public.price_sheet_items FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update price sheet items"
ON public.price_sheet_items FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete price sheet items"
ON public.price_sheet_items FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ==========================================
-- 4. FIX: echivalente_produse RLS Policies
-- ==========================================
DROP POLICY IF EXISTS "Authenticated can view echivalente" ON public.echivalente_produse;
DROP POLICY IF EXISTS "Admins can manage echivalente" ON public.echivalente_produse;
DROP POLICY IF EXISTS "Authenticated users can view equivalences" ON public.echivalente_produse;
DROP POLICY IF EXISTS "Authenticated users can insert equivalences" ON public.echivalente_produse;
DROP POLICY IF EXISTS "Admins can manage equivalences" ON public.echivalente_produse;
DROP POLICY IF EXISTS "Authenticated users can view own equivalences" ON public.echivalente_produse;
DROP POLICY IF EXISTS "Authenticated users can insert own equivalences" ON public.echivalente_produse;
DROP POLICY IF EXISTS "Admins can update equivalences" ON public.echivalente_produse;
DROP POLICY IF EXISTS "Admins can delete equivalences" ON public.echivalente_produse;

CREATE POLICY "Authenticated users can view equivalences"
ON public.echivalente_produse FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert own equivalences"
ON public.echivalente_produse FOR INSERT TO authenticated
WITH CHECK (auth.uid() = creat_de OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update equivalences"
ON public.echivalente_produse FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete equivalences"
ON public.echivalente_produse FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ==========================================
-- 5. FIX: 'imports' Storage Bucket & RLS
-- ==========================================
-- Ensure storage schema buckets table exists and insert imports bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('imports', 'imports', false, 52428800, null)
ON CONFLICT (id) DO NOTHING;

-- Revoke all unrestricted operations on storage.objects for imports bucket and restrict to authenticated
DROP POLICY IF EXISTS "Allow authenticated select from imports bucket" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated insert into imports bucket" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete from imports bucket" ON storage.objects;

CREATE POLICY "Allow authenticated select from imports bucket"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'imports');

CREATE POLICY "Allow authenticated insert into imports bucket"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'imports' AND auth.uid() = owner);

CREATE POLICY "Allow authenticated delete from imports bucket"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'imports' AND auth.uid() = owner);

-- ==========================================
-- 6. FIX: SECURITY DEFINER Functions Privilege Revocations
-- ==========================================
-- Revoke PUBLIC execution privilege to fix warnings
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM public;

-- Grant execution to proper roles
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO authenticated, service_role;
