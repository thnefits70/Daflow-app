-- Pedido del usuario 2026-09-30: Bryan confirma que Dropi anuló la guía.
ALTER TABLE "DropiDiscontinuedSale" ADD COLUMN "orderCancelledAt" TIMESTAMP(3),
ADD COLUMN "orderCancelledById" TEXT;
