-- AlterTable: replace single "weekday" (Int?) with "weekdays" (Int[]) so a
-- WEEKLY reminder can fire on more than one day (Robert's request, ago-21).
ALTER TABLE "PeriodicReminder" ADD COLUMN "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

UPDATE "PeriodicReminder" SET "weekdays" = ARRAY["weekday"] WHERE "weekday" IS NOT NULL;

ALTER TABLE "PeriodicReminder" DROP COLUMN "weekday";
