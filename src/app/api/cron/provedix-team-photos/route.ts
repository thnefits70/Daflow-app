import { NextRequest, NextResponse } from "next/server";
import { syncTeamPhotosFromDrive } from "@/lib/provedixTeamPhotoSync";

// Bajar fotos de Drive + una consulta de IA con todas las fotos juntas.
export const maxDuration = 300;

// Fotos del equipo para provedix.com (pedido del usuario 2026-10-16): los
// días 1 y 15 a las 7:00 de Guayaquil (vercel.json) se revisa sola la carpeta
// de Drive, sin depender de que alguien tenga la computadora prendida. Mismo
// CRON_SECRET que los otros crons.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  try {
    const result = await syncTeamPhotosFromDrive();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("Fotos del equipo (Drive):", err);
    return NextResponse.json({ ok: false, error: "No se pudo revisar la carpeta de Drive." }, { status: 500 });
  }
}
