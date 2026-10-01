-- Rol "Asesor(a) B2B" (2026-09-30)
ALTER TABLE "User" ADD COLUMN "isB2BAdvisor" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "b2bAdvisorTitle" TEXT,
ADD COLUMN "b2bAdvisorProvisional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "b2bAdvisorGrantedFlags" TEXT[] DEFAULT ARRAY[]::TEXT[];
