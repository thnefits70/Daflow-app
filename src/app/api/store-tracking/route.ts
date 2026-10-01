import { NextResponse } from "next/server";
import { canLinkStoreProducts, canViewStoreTracking } from "@/lib/guards";
import { getStoreTrackingData } from "@/lib/storeTracking";

// Seguimiento de tiendas (Análisis de Mercado) — solo lectura para Yair,
// Bryan y admin (ver canViewStoreTracking).
export async function GET() {
  if (!(await canViewStoreTracking())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const data = await getStoreTrackingData();
  return NextResponse.json({ ...data, canLink: await canLinkStoreProducts() });
}
