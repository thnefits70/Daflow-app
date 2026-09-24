import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { findSupplierByPublicSheetToken } from "@/lib/supplierDebt";
import { SupplierSheet } from "@/components/supplier-ledger/SupplierSheet";

// Confirmado 2026-09-24, pedido explícito del usuario: tercer enlace de CHEN
// (mismo dominio dunxingchen.cc) — un solo enlace para todo su equipo, que
// se ve y se usa como una hoja de Excel en línea donde escriben lo que
// quieran. Llave propia (publicSheetToken): nunca abre el saldo ni los envíos.
export const metadata: Metadata = {
  title: "Hoja de cálculo",
  description: "Hoja de cálculo del equipo.",
  icons: {
    icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  },
};

export default async function SupplierSheetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await findSupplierByPublicSheetToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") notFound();
  return <SupplierSheet token={token} />;
}
