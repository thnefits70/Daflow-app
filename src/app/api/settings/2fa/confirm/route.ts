import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { verifyTwoFactorCode, generateBackupCodes } from "@/lib/twoFactor";

const schema = z.object({ secret: z.string(), code: z.string() });

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  if (!verifyTwoFactorCode(parsed.data.code, parsed.data.secret)) {
    return NextResponse.json({ error: "Código incorrecto." }, { status: 401 });
  }

  const { codes, hashes } = await generateBackupCodes();
  await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { adminTwoFactorEnabled: true, adminTwoFactorSecret: parsed.data.secret, adminTwoFactorBackupCodes: hashes },
  });
  return NextResponse.json({ ok: true, backupCodes: codes });
}
