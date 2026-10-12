-- Seguridad (2026-10-12, aprobado por el usuario): Supabase expone la API REST
-- (PostgREST) con la clave pública "anon", que va dentro del código del
-- navegador. Con RLS apagado y permisos para anon/authenticated, cualquiera
-- podía LEER todas las tablas de DAFLOW sin iniciar sesión. DAFLOW nunca usa
-- esa vía: lee y escribe solo por Prisma con el usuario postgres (dueño de las
-- tablas, con BYPASSRLS), así que esto no le afecta. Storage (fotos y
-- archivos) vive en otro esquema y tampoco se toca.

-- 1) RLS encendido en todas las tablas del esquema public (sin políticas =
--    nadie entra por la API REST).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

-- 2) Sin permisos para los roles de la API REST.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- 3) Y lo mismo para las tablas que se creen en el futuro.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
