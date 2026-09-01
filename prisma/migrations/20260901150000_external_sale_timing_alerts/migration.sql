-- AlterTable
ALTER TABLE "ExternalSale" ADD COLUMN     "contraEntregaPaymentAlertSentAt" TIMESTAMP(3),
ADD COLUMN     "deliveryOverdueAlertSentAt" TIMESTAMP(3);

