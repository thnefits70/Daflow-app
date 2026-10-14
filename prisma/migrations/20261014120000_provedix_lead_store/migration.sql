-- Registro de provedix.com: nombre de la tienda, plataforma y correo (2026-10-14).
ALTER TABLE "ProvedixLead" ADD COLUMN "storeName" TEXT;
ALTER TABLE "ProvedixLead" ADD COLUMN "platform" TEXT;
ALTER TABLE "ProvedixLead" ADD COLUMN "platformEmail" TEXT;
