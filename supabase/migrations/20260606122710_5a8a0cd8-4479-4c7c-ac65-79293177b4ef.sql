CREATE TABLE public.ai_memory (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  prompt_context text NOT NULL,
  ai_message text,
  correction text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_memory TO authenticated;
GRANT ALL ON public.ai_memory TO service_role;

ALTER TABLE public.ai_memory ENABLE ROW LEVEL SECURITY;

-- Per-company: every authenticated user can read all corrections
CREATE POLICY "Authenticated can view all ai_memory"
  ON public.ai_memory FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own ai_memory"
  ON public.ai_memory FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ai_memory"
  ON public.ai_memory FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can delete own ai_memory"
  ON public.ai_memory FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage ai_memory"
  ON public.ai_memory FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Full-text search index (Romanian-friendly via 'simple' to keep diacritics-tolerant)
CREATE INDEX ai_memory_fts_idx ON public.ai_memory
  USING GIN (to_tsvector('simple', coalesce(correction,'') || ' ' || coalesce(prompt_context,'')));

CREATE INDEX ai_memory_tags_idx ON public.ai_memory USING GIN (tags);

CREATE TRIGGER update_ai_memory_updated_at
  BEFORE UPDATE ON public.ai_memory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RPC: returns top 5 relevant corrections company-wide for a given query text
CREATE OR REPLACE FUNCTION public.match_ai_memory(query_text text)
RETURNS TABLE (
  id uuid,
  prompt_context text,
  ai_message text,
  correction text,
  tags text[],
  rank real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.prompt_context,
    m.ai_message,
    m.correction,
    m.tags,
    ts_rank(
      to_tsvector('simple', coalesce(m.correction,'') || ' ' || coalesce(m.prompt_context,'')),
      plainto_tsquery('simple', query_text)
    ) AS rank
  FROM public.ai_memory m
  WHERE
    query_text IS NOT NULL
    AND length(trim(query_text)) > 0
    AND (
      to_tsvector('simple', coalesce(m.correction,'') || ' ' || coalesce(m.prompt_context,''))
        @@ plainto_tsquery('simple', query_text)
      OR m.tags && string_to_array(lower(query_text), ' ')
    )
  ORDER BY rank DESC, m.created_at DESC
  LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION public.match_ai_memory(text) TO authenticated;