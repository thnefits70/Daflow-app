import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { adminTwoFactorEnabled: false, adminTwoFactorSecret: null, adminTwoFactorBackupCodes: [] },
  });
  return NextResponse.json({ ok: true });
}
