CREATE OR REPLACE FUNCTION public.auto_map_supplier()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.supplier_id IS NULL THEN
    IF NEW.brand IS NOT NULL THEN
      SELECT id INTO NEW.supplier_id
      FROM suppliers
      WHERE LOWER(TRIM(name)) = LOWER(TRIM(NEW.brand))
      LIMIT 1;
    END IF;
    IF NEW.supplier_id IS NULL AND NEW.manufacturer IS NOT NULL THEN
      SELECT id INTO NEW.supplier_id
      FROM suppliers
      WHERE LOWER(TRIM(name)) = LOWER(TRIM(NEW.manufacturer))
      LIMIT 1;
    END IF;
    IF NEW.supplier_id IS NULL AND NEW.denumire_completa IS NOT NULL THEN
      SELECT id INTO NEW.supplier_id
      FROM suppliers
      WHERE LENGTH(name) > 3
        AND NEW.denumire_completa ILIKE '%' || name || '%'
      ORDER BY LENGTH(name) DESC
      LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_ai_product_info(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_ai_memory(text) FROM anon;