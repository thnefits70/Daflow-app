import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SHEET_SESSION_COOKIE, sha256 } from "@/lib/supplierSheetAccess";

// Confirmado 2026-09-24: "Salir" en la hoja de CHEN — borra la sesión de este dispositivo.
export async function POST(req: NextRequest) {
  const raw = req.cookies.get(SHEET_SESSION_COOKIE)?.value;
  if (raw) await prisma.supplierSheetSession.deleteMany({ where: { tokenHash: sha256(raw) } });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SHEET_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
