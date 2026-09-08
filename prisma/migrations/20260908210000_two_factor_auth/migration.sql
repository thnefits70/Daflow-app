-- AlterTable
ALTER TABLE "PlatformSettings"
  ADD COLUMN     "adminTwoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN     "adminTwoFactorSecret" TEXT,
  ADD COLUMN     "adminTwoFactorBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN     "twoFactorSecret" TEXT,
  ADD COLUMN     "twoFactorBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
