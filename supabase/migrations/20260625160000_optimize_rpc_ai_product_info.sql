-- Rescrie get_ai_product_info pentru a citi din fisa_tehnica_specs daca exista
CREATE OR REPLACE FUNCTION public.get_ai_product_info(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product     RECORD;
  v_gemini_key  TEXT;
  v_resp        http_response;
  v_ai_text     TEXT;
  v_ai_info     JSONB;
  v_new_specs   JSONB;
  v_prompt      TEXT;
  v_body        TEXT;
BEGIN
  SET LOCAL statement_timeout = '60s';

  -- 1. Fetch produs
  SELECT id, cod_intern, denumire_completa, unit, pret_lista, brand, specifications
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
        'source', 'fisa_tehnica_specs' -- indicator de provenienta
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

  -- 3. Cache 30 zile pentru cautarile cu Gemini
  IF (v_product.specifications -> 'ai_info' ->> 'updated_at') IS NOT NULL
  AND (NOW() - (v_product.specifications -> 'ai_info' ->> 'updated_at')::TIMESTAMPTZ) < INTERVAL '30 days'
  THEN
    RETURN jsonb_build_object(
      'success',    true,
      'data',       jsonb_build_object(p_product_id::TEXT, v_product.specifications -> 'ai_info'),
      'from_cache', true
    );
  END IF;

  -- 4. Cheia Gemini din Vault
  SELECT decrypted_secret INTO v_gemini_key
  FROM vault.decrypted_secrets WHERE name = 'GEMINI_API_KEY' LIMIT 1;

  IF v_gemini_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'GEMINI_API_KEY lipseste din Vault');
  END IF;

  -- Curatare cheie de whitespace-uri si newlines accidentale din Vault
  v_gemini_key := regexp_replace(v_gemini_key, '\s+', '', 'g');

  -- 5. Prompt
  v_prompt := format(
    E'Esti expert in materiale de constructii din Romania (Baumit, Weber, Ceresit, Knauf, Leier, Bramac, etc.).\n'
    'Raspunde DOAR cu informatii pe care le cunosti cu certitudine. Daca nu esti sigur, scrie "necunoscut".\n\n'
    'Produs: "%s"\nBrand: %s | UM: %s | Pret: %s lei\n\n'
    'Furnizeaza date tehnice pentru acest produs.',
    v_product.denumire_completa,
    COALESCE(v_product.brand, 'necunoscut'),
    COALESCE(v_product.unit, 'buc'),
    v_product.pret_lista::TEXT
  );

  -- 6. Body request Gemini cu schema JSON structurata
  v_body := jsonb_build_object(
    'contents', jsonb_build_array(jsonb_build_object(
      'role',  'user',
      'parts', jsonb_build_array(jsonb_build_object('text', v_prompt))
    )),
    'generationConfig', jsonb_build_object(
      'responseMimeType', 'application/json',
      'responseSchema', jsonb_build_object(
        'type', 'OBJECT',
        'properties', jsonb_build_object(
          'consum',          jsonb_build_object('type', 'STRING', 'description', 'Consum per mp/unitate, ex: 4-6 kg/mp sau N/A'),
          'ambalaj',         jsonb_build_object('type', 'STRING', 'description', 'Tip si greumate ambalaj, ex: sac 25 kg'),
          'alternative',     jsonb_build_object(
                               'type',  'ARRAY',
                               'items', jsonb_build_object('type', 'STRING'),
                               'description', 'Maxim 3 produse alternative echivalente (brand + denumire)'
                             ),
          'compatibilitati', jsonb_build_object('type', 'STRING', 'description', 'Cu ce materiale/suporturi e compatibil'),
          'utilizare',       jsonb_build_object('type', 'STRING', 'description', 'interior/exterior/ambele + aplicatii specifice')
        ),
        'required', '["consum","ambalaj","alternative","compatibilitati","utilizare"]'::JSONB
      )
    )
  )::TEXT;

  -- 7. Apel HTTP sincron catre Gemini
  PERFORM http_set_curlopt('CURLOPT_TIMEOUT', '30');

  SELECT * INTO v_resp FROM http_post(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' || v_gemini_key,
    v_body,
    'application/json'
  );

  IF v_resp.status != 200 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Gemini API error HTTP %s: %s', v_resp.status, LEFT(v_resp.content, 300))
    );
  END IF;

  -- 8. Extrage textul JSON din raspuns
  BEGIN
    v_ai_text := (v_resp.content::JSONB) -> 'candidates' -> 0 -> 'content' -> 'parts' -> 0 ->> 'text';
    IF v_ai_text IS NULL THEN
      RAISE EXCEPTION 'Gemini nu a returnat text valid. Content: %', LEFT(v_resp.content, 400);
    END IF;
    v_ai_info := v_ai_text::JSONB || jsonb_build_object('updated_at', NOW()::TEXT);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'Parse error: ' || SQLERRM);
  END;

  -- 9. Salveaza in baza de date
  v_new_specs := COALESCE(v_product.specifications, '{}'::JSONB)
                 || jsonb_build_object('ai_info', v_ai_info);
  UPDATE public.products SET specifications = v_new_specs WHERE id = p_product_id;

  RETURN jsonb_build_object(
    'success',    true,
    'data',       jsonb_build_object(p_product_id::TEXT, v_ai_info),
    'from_cache', false
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'Eroare: ' || SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_product_info(UUID) TO authenticated;
