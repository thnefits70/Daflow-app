-- Pedido del usuario 2026-10-05: permiso propio para garantías locales,
-- separado de Ventas Externas (B2B). Se activa para Michelle, Jariel, Yair y
-- Marcos (confirmado por el usuario).
ALTER TABLE "User" ADD COLUMN "canManageLocalWarranties" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "canManageLocalWarranties" = true
WHERE "username" IN ('mramirez', 'jarielmurillo2026', 'yairurgilez', 'marcos2026');
