-- Creează tabela app_config dacă nu există
CREATE TABLE IF NOT EXISTS public.app_config (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Activează Row Level Security (RLS)
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Șterge politica dacă există deja, apoi o re-creează
DROP POLICY IF EXISTS "Authenticated users can read config" ON public.app_config;
CREATE POLICY "Authenticated users can read config"
ON public.app_config FOR SELECT
TO authenticated USING (true);

-- Șterge cheile vechi care s-au mutat în Vault
DELETE FROM public.app_config WHERE key IN ('anthropic_api_key', 'gemini_api_key');