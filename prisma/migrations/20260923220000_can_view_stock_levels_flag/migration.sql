-- Stock Actual en solo lectura para colaboradores delegados (Heidy, Jariel, Robert, Marcos).
ALTER TABLE "User" ADD COLUMN "canViewStockLevels" BOOLEAN NOT NULL DEFAULT false;
