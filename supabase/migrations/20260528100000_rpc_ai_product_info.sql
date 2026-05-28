-- ============================================================
-- RPC: get_ai_product_info
-- Înlocuiește logica din edge function "ai-product-info" (action: tech-info)
-- pentru că matching-ul după cod_intern din edge function eșuează.
-- Apelează Gemini direct via pg_net, stochează rezultatul în specifications.
--
-- Prerequisit: cheia Gemini trebuie adăugată în Supabase Vault:
--   SELECT vault.create_secret('CHEIA_TA_GEMINI', 'GEMINI_API_KEY');
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_ai_product_info(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product       RECORD;
  v_gemini_key    TEXT;
  v_request_id    BIGINT;
  v_status_code   INT;
  v_content       TEXT;
  v_timed_out     BOOLEAN;
  v_ai_text       TEXT;
  v_ai_info       JSONB;
  v_new_specs     JSONB;
  v_poll          INT := 0;
  v_found         BOOLEAN := false;
  v_prompt        TEXT;
BEGIN
  -- Extinde timeout-ul sesiunii pentru a da timp răspunsului Gemini
  SET LOCAL statement_timeout = '60s';

  -- 1. Fetch produs
  SELECT id, cod_intern, denumire_completa, unit, pret_lista, brand, specifications
  INTO v_product
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Produsul nu a fost găsit');
  END IF;

  -- 2. Cache: dacă ai_info există și e mai vechi de 30 zile, returnează din cache
  IF (v_product.specifications -> 'ai_info' ->> 'updated_at') IS NOT NULL
     AND (NOW() - (v_product.specifications -> 'ai_info' ->> 'updated_at')::TIMESTAMPTZ) < INTERVAL '30 days'
  THEN
    RETURN jsonb_build_object(
      'success',    true,
      'data',       jsonb_build_object(p_product_id::TEXT, v_product.specifications -> 'ai_info'),
      'from_cache', true
    );
  END IF;

  -- 3. Citește cheia Gemini din Supabase Vault
  SELECT decrypted_secret INTO v_gemini_key
  FROM vault.decrypted_secrets
  WHERE name = 'GEMINI_API_KEY'
  LIMIT 1;

  IF v_gemini_key IS NULL OR v_gemini_key = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'GEMINI_API_KEY lipsește din Vault. Rulați în SQL Editor: SELECT vault.create_secret(''CHEIA_VOASTRA'', ''GEMINI_API_KEY'');'
    );
  END IF;

  -- 4. Construiește prompt-ul pentru Gemini
  v_prompt := format(
    E'Ești expert în materiale de construcții din România (Baumit, Weber, Ceresit, Knauf, Leier, Bramac, etc.).\n'
    'Răspunde DOAR cu informații pe care le cunoști cu certitudine. Dacă nu ești sigur, scrie "necunoscut".\n\n'
    'Produs: "%s"\nBrand: %s | UM: %s | Preț: %s lei\n\n'
    'Furnizează date tehnice pentru acest produs.',
    v_product.denumire_completa,
    COALESCE(v_product.brand, 'necunoscut'),
    COALESCE(v_product.unit, 'buc'),
    v_product.pret_lista::TEXT
  );

  -- 5. Trimite request HTTP la Gemini via pg_net (async, timeout 40s)
  SELECT net.http_post(
    url     := 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' || v_gemini_key,
    body    := jsonb_build_object(
      'contents', jsonb_build_array(
        jsonb_build_object(
          'role',  'user',
          'parts', jsonb_build_array(jsonb_build_object('text', v_prompt))
        )
      ),
      'generationConfig', jsonb_build_object(
        'responseMimeType', 'application/json',
        'responseSchema', jsonb_build_object(
          'type', 'OBJECT',
          'properties', jsonb_build_object(
            'consum',         jsonb_build_object('type', 'STRING', 'description', 'Consum per mp/unitate, ex: "4-6 kg/mp" sau "N/A"'),
            'ambalaj',        jsonb_build_object('type', 'STRING', 'description', 'Tip si greutate ambalaj, ex: "sac 25 kg"'),
            'alternative',    jsonb_build_object(
                                'type', 'ARRAY',
                                'items', jsonb_build_object('type', 'STRING'),
                                'description', 'Maxim 3 produse alternative echivalente (brand + denumire)'
                              ),
            'compatibilitati',jsonb_build_object('type', 'STRING', 'description', 'Cu ce materiale/suporturi e compatibil'),
            'utilizare',      jsonb_build_object('type', 'STRING', 'description', 'interior/exterior/ambele + aplicatii specifice')
          ),
          'required', '["consum","ambalaj","alternative","compatibilitati","utilizare"]'::JSONB
        )
      )
    ),
    timeout_milliseconds := 40000
  ) INTO v_request_id;

  -- 6. Polling pentru răspuns (max 40 iterații × 1s = 40s)
  LOOP
    v_poll := v_poll + 1;
    PERFORM pg_sleep(1);

    SELECT status_code, content, timed_out
    INTO   v_status_code, v_content, v_timed_out
    FROM   net._http_response
    WHERE  id = v_request_id;

    IF FOUND THEN
      v_found := true;
      EXIT;
    END IF;

    EXIT WHEN v_poll >= 40;
  END LOOP;

  IF NOT v_found THEN
    RETURN jsonb_build_object('success', false, 'error', 'Timeout: Gemini nu a răspuns în 40 secunde');
  END IF;

  IF v_timed_out THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cererea HTTP către Gemini a expirat');
  END IF;

  IF v_status_code != 200 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('Gemini API error HTTP %s: %s', v_status_code, LEFT(v_content, 300))
    );
  END IF;

  -- 7. Extrage textul JSON din răspunsul Gemini
  BEGIN
    v_ai_text := (v_content::JSONB) -> 'candidates' -> 0 -> 'content' -> 'parts' -> 0 ->> 'text';
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'Eroare la parsarea răspunsului Gemini: ' || SQLERRM);
  END;

  IF v_ai_text IS NULL OR v_ai_text = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Gemini nu a returnat text. Răspuns: ' || LEFT(v_content, 300)
    );
  END IF;

  -- 8. Parsează JSON-ul și adaugă timestamp
  BEGIN
    v_ai_info := v_ai_text::JSONB || jsonb_build_object('updated_at', NOW()::TEXT);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'JSON invalid de la Gemini: ' || LEFT(v_ai_text, 200));
  END;

  -- 9. Salvează în baza de date
  v_new_specs := COALESCE(v_product.specifications, '{}'::JSONB)
                 || jsonb_build_object('ai_info', v_ai_info);

  UPDATE public.products
  SET    specifications = v_new_specs
  WHERE  id = p_product_id;

  -- 10. Returnează rezultatul (același format ca edge function)
  RETURN jsonb_build_object(
    'success',    true,
    'data',       jsonb_build_object(p_product_id::TEXT, v_ai_info),
    'from_cache', false
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'Eroare neașteptată: ' || SQLERRM);
END;
$$;

-- Permite utilizatorilor autentificați să apeleze funcția
GRANT EXECUTE ON FUNCTION public.get_ai_product_info(UUID) TO authenticated;
