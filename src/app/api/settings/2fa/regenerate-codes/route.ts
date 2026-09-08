import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { generateBackupCodes } from "@/lib/twoFactor";

export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });
  if (!settings?.adminTwoFactorEnabled) {
    return NextResponse.json({ error: "El autenticador no está activo." }, { status: 400 });
  }

  const { codes, hashes } = await generateBackupCodes();
  await prisma.platformSettings.update({ where: { id: "singleton" }, data: { adminTwoFactorBackupCodes: hashes } });
  return NextResponse.json({ ok: true, backupCodes: codes });
}
