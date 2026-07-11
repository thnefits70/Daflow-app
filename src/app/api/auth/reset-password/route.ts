import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres."),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "El enlace ya no es válido. Solicita uno nuevo." }, { status: 400 });
  }

  const adminPasswordHash = await hashPassword(parsed.data.password);
  await prisma.$transaction([
    prisma.platformSettings.update({ where: { id: "singleton" }, data: { adminPasswordHash } }),
    prisma.passwordResetToken.update({ where: { tokenHash }, data: { usedAt: new Date() } }),
  ]);

  return NextResponse.json({ ok: true });
}
