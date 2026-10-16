import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { retirePhoto, syncTeamPhotosFromDrive } from "@/lib/provedixTeamPhotoSync";

export const maxDuration = 300;

// Sección Provedix del admin (2026-10-16): "Revisar Drive ahora" y "Quitar"
// una foto del equipo de la página. Solo el admin.
export async function POST() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, ...(await syncTeamPhotosFromDrive()) });
  } catch (err) {
    console.error("Fotos del equipo (Drive, manual):", err);
    return NextResponse.json({ error: "No se pudo revisar la carpeta de Drive. Intenta de nuevo en un rato." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const driveId = req.nextUrl.searchParams.get("driveId")?.trim();
  if (!driveId || !/^[\w-]{10,80}$/.test(driveId)) return NextResponse.json({ error: "Falta la foto." }, { status: 400 });
  await retirePhoto(driveId, "Quitada por el admin");
  return NextResponse.json({ ok: true });
}
