import { NextResponse } from "next/server";
import { findSupplierByPublicShippingToken } from "@/lib/supplierDebt";

// Confirmado 2026-09-23: en iPhone, las notificaciones push solo funcionan
// si la página se agregó a la pantalla de inicio y se abre desde ese ícono.
// Este manifest hace que ese ícono abra directo ESTE enlace (con su token),
// con un nombre neutral — nada de DAFLOW.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await findSupplierByPublicShippingToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") return new NextResponse(null, { status: 404 });

  const startUrl = `/proveedor-ledger/envios/${token}`;
  return NextResponse.json(
    {
      name: "Pedidos por enviar",
      short_name: "Pedidos",
      start_url: startUrl,
      scope: "/proveedor-ledger/",
      display: "standalone",
      background_color: "#fafafa",
      theme_color: "#fafafa",
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" } }
  );
}
