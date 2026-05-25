WITH candidates AS (
  SELECT id
  FROM public.products
  WHERE pret_lista = 0
    AND (
      lower(coalesce(denumire_completa, '')) LIKE '%403%'
      OR lower(coalesce(description, '')) LIKE '%403%'
      OR lower(coalesce(source_url, '')) LIKE '%403%'
      OR lower(coalesce(denumire_completa, '')) LIKE '%forbidden%'
      OR lower(coalesce(description, '')) LIKE '%forbidden%'
      OR lower(coalesce(denumire_completa, '')) LIKE '%access denied%'
      OR lower(coalesce(description, '')) LIKE '%access denied%'
      OR lower(coalesce(denumire_completa, '')) LIKE '%captcha%'
      OR lower(coalesce(description, '')) LIKE '%captcha%'
      OR lower(coalesce(denumire_completa, '')) LIKE '%cloudflare%'
      OR lower(coalesce(description, '')) LIKE '%cloudflare%'
    )
)
DELETE FROM public.products p
USING candidates c
WHERE p.id = c.id;
