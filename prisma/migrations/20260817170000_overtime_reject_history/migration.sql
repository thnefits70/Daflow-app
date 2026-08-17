-- Rechazar una hora extra ya no borra el registro — queda como historial
-- visible para el líder que lo cargó, el admin y Nairoby.
ALTER TABLE "OvertimeEntry" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "OvertimeEntry" ADD COLUMN "rejectedById" TEXT;

ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
