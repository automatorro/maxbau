ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS fisa_tehnica_url text,
  ADD COLUMN IF NOT EXISTS fisa_tehnica_storage_path text,
  ADD COLUMN IF NOT EXISTS fisa_tehnica_processed boolean NOT NULL DEFAULT false;