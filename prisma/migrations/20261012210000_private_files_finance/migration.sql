-- Seguridad, segunda etapa (2026-10-12, aprobado por el usuario): documentos
-- financieros internos copiados al bucket privado "daflow-private". Sus
-- enlaces guardados pasan a https://www.daflow.app/api/files/... (exige
-- sesión). Se recorren TODAS las columnas de texto, listas de texto y JSON
-- del esquema public, para no dejar ningún enlace viejo (incluye borradores).
-- NO entran supplier-debt-transfers ni supplier-shipping-photos (los ve CHEN
-- sin sesión en su hoja de Google) ni fotos de producto.
DO $$
DECLARE
  col record;
  pat text := 'https://[^/" ]+/storage/v1/object/public/daflow-files/(purchase-payments|petty-cash|admin-payments|purchase-invoices|purchase-quotes|purchase-orders|purchase-receipts|purchase-price-corrections|external-payment-proofs|external-payment-invoices|external-sale-payment-proofs|external-sale-invoices|supplier-credits|finance-kpis|inventory-proofs|mismanagement-evidence)/';
  rep text := 'https://www.daflow.app/api/files/\1/';
BEGIN
  FOR col IN
    SELECT table_name, column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (data_type IN ('text', 'character varying', 'jsonb') OR udt_name IN ('_text', '_varchar'))
  LOOP
    IF col.udt_name IN ('_text', '_varchar') THEN
      EXECUTE format(
        'UPDATE public.%I SET %I = ARRAY(SELECT regexp_replace(u, $1, $2, ''g'') FROM unnest(%I) WITH ORDINALITY AS t(u, i) ORDER BY i) WHERE array_to_string(%I, '' '') ~ $1',
        col.table_name, col.column_name, col.column_name, col.column_name) USING pat, rep;
    ELSIF col.data_type = 'jsonb' THEN
      EXECUTE format(
        'UPDATE public.%I SET %I = regexp_replace(%I::text, $1, $2, ''g'')::jsonb WHERE %I::text ~ $1',
        col.table_name, col.column_name, col.column_name, col.column_name) USING pat, rep;
    ELSE
      EXECUTE format(
        'UPDATE public.%I SET %I = regexp_replace(%I, $1, $2, ''g'') WHERE %I ~ $1',
        col.table_name, col.column_name, col.column_name, col.column_name) USING pat, rep;
    END IF;
  END LOOP;
END $$;
