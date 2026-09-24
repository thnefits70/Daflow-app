import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { findSupplierByPublicSheetToken } from "@/lib/supplierDebt";
import { getSheetViewer } from "@/lib/supplierSheetAccess";
import { SupplierSheet } from "@/components/supplier-ledger/SupplierSheet";
import { SupplierSheetLogin } from "@/components/supplier-ledger/SupplierSheetLogin";

// Confirmado 2026-09-24, pedido explícito del usuario: tercer enlace de CHEN
// (mismo dominio dunxingchen.cc) — se ve y se usa como una hoja de Excel en
// línea. Llave propia (publicSheetToken): nunca abre el saldo ni los envíos.
// Confirmado 2026-09-24: además del enlace, solo entra un correo de la lista
// que carga el admin — sin sesión se muestra únicamente la pantalla de correo.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hoja de cálculo",
  description: "Hoja de cálculo del equipo.",
  robots: { index: false, follow: false },
  icons: {
    icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  },
};

export default async function SupplierSheetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await findSupplierByPublicSheetToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") notFound();

  const viewer = await getSheetViewer(supplier.id);
  if (!viewer) return <SupplierSheetLogin token={token} />;
  return <SupplierSheet token={token} email={viewer.email} canWrite={viewer.canWrite} side={viewer.side} />;
}
