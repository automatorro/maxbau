-- Rescrie get_ai_product_info pentru a elimina apelul HTTP din Postgres
CREATE OR REPLACE FUNCTION public.get_ai_product_info(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product     RECORD;
  v_ai_info     JSONB;
  v_new_specs   JSONB;
BEGIN
  SET LOCAL statement_timeout = '10s';

  -- 1. Fetch produs
  SELECT id, cod_intern, denumire_completa, specifications
  INTO v_product FROM public.products WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Produsul nu a fost gasit');
  END IF;

  -- 2. Daca avem deja fisa_tehnica_specs, mapam acele informatii in structura ai_info si le salvam direct!
  IF (v_product.specifications -> 'fisa_tehnica_specs') IS NOT NULL THEN
    DECLARE
      v_ft_specs JSONB;
      v_ft_consum TEXT;
      v_ft_ambalaj TEXT;
      v_ft_compatibilitati TEXT;
      v_ft_utilizare TEXT;
      v_ft_alternative JSONB;
    BEGIN
      v_ft_specs := v_product.specifications -> 'fisa_tehnica_specs';
      
      -- Extragere consum si ambalaj
      v_ft_consum := COALESCE(v_ft_specs ->> 'consum', 'N/A');
      v_ft_ambalaj := COALESCE(v_ft_specs ->> 'ambalaj', 'N/A');
      
      -- Extragere alternative
      v_ft_alternative := COALESCE(v_ft_specs -> 'alternative', '[]'::JSONB);
      
      -- Convertire array compatibil_cu -> text separat prin virgula
      IF jsonb_typeof(v_ft_specs -> 'compatibil_cu') = 'array' THEN
        SELECT COALESCE(string_agg(elem, ', '), 'N/A') INTO v_ft_compatibilitati
        FROM jsonb_array_elements_text(v_ft_specs -> 'compatibil_cu') AS elem;
      ELSE
        v_ft_compatibilitati := COALESCE(v_ft_specs ->> 'compatibil_cu', 'N/A');
      END IF;
      
      -- Convertire array utilizare -> text separat prin virgula
      IF jsonb_typeof(v_ft_specs -> 'utilizare') = 'array' THEN
        SELECT COALESCE(string_agg(elem, ', '), 'N/A') INTO v_ft_utilizare
        FROM jsonb_array_elements_text(v_ft_specs -> 'utilizare') AS elem;
      ELSE
        v_ft_utilizare := COALESCE(v_ft_specs ->> 'utilizare', 'N/A');
      END IF;

      -- Formeaza obiectul ai_info final
      v_ai_info := jsonb_build_object(
        'consum', v_ft_consum,
        'ambalaj', v_ft_ambalaj,
        'alternative', v_ft_alternative,
        'compatibilitati', v_ft_compatibilitati,
        'utilizare', v_ft_utilizare,
        'updated_at', NOW()::TEXT,
        'source', 'fisa_tehnica_specs'
      );

      -- Salveaza in specifications in DB
      v_new_specs := COALESCE(v_product.specifications, '{}'::JSONB)
                     || jsonb_build_object('ai_info', v_ai_info);
                     
      UPDATE public.products SET specifications = v_new_specs WHERE id = p_product_id;

      RETURN jsonb_build_object(
        'success',    true,
        'data',       jsonb_build_object(p_product_id::TEXT, v_ai_info),
        'from_cache', false,
        'source',     'fisa_tehnica_specs'
      );
    END;
  END IF;

  -- 3. Returneaza cache daca exista
  IF (v_product.specifications -> 'ai_info' ->> 'updated_at') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success',    true,
      'data',       jsonb_build_object(p_product_id::TEXT, v_product.specifications -> 'ai_info'),
      'from_cache', true
    );
  END IF;

  -- 4. Returneaza cod special pentru generare prin Edge Function (fara timeout)
  RETURN jsonb_build_object(
    'success', false,
    'error', 'live_generation_required',
    'message', 'Generarea live necesita apelarea Edge Function-ului ai-product-info'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'Eroare: ' || SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_product_info(UUID) TO authenticated;
