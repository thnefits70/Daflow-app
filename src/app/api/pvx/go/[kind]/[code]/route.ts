import { NextRequest, NextResponse } from "next/server";
import { getSheetProducts } from "@/lib/provedixSheets";
import { hitAllowed, tooMany } from "@/lib/provedixVisitor";

// Enlaces cortos de los botones del chat de Michelle (2026-10-14):
// /api/pvx/go/dropi/<ID>     → el producto en Dropi (precio actualizado al instante)
// /api/pvx/go/creativos/<ID> → carpeta de creativos (hojas del equipo)
// /api/pvx/go/landing/<ID>   → landing con IA (hojas del equipo)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string; code: string }> },
) {
  // Límite contra bots (2026-10-16): 60 enlaces por minuto por conexión.
  if (!hitAllowed(req, "go", 60, 60_000)) return tooMany();
  const { kind, code } = await params;
  if (!/^\d{3,8}$/.test(code))
    return NextResponse.json({ error: "ID no válido." }, { status: 400 });
  if (kind === "dropi")
    return NextResponse.redirect(
      `https://app.dropi.ec/dashboard/search?search=${encodeURIComponent(code)}&search_type=semantic`,
      302,
    );
  if (kind === "creativos" || kind === "landing") {
    const p = (await getSheetProducts()).find((x) => x.code === code);
    const url = kind === "creativos" ? p?.creatives : p?.landing;
    if (url) return NextResponse.redirect(url, 302);
    return NextResponse.json(
      { error: "Ese material todavía no está disponible." },
      { status: 404 },
    );
  }
  return NextResponse.json({ error: "Enlace no válido." }, { status: 404 });
}
