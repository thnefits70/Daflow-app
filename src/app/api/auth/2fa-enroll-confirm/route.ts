import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { verifyTwoFactorCode, generateBackupCodes, TWO_FACTOR_REQUIRED_DEPT_CODES } from "@/lib/twoFactor";

const schema = z.object({
  mode: z.enum(["admin", "team"]),
  username: z.string().trim().optional(),
  password: z.string(),
  secret: z.string(),
  code: z.string(),
});

// Segundo paso del ENROLL (primera vez que alguien de un depto obligado
// configura su autenticador): vuelve a validar la contraseña, verifica que
// el código de 6 dígitos de verdad corresponde al secreto que se le mostró
// en el QR, y recién ahí lo guarda — así nunca queda un secreto persistido
// sin que la persona haya demostrado que efectivamente lo escaneó.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Datos inválidos." }, { status: 400 });
  const { mode, username, password, secret, code } = parsed.data;

  if (!verifyTwoFactorCode(code, secret)) {
    return NextResponse.json({ ok: false, error: "Código incorrecto." }, { status: 401 });
  }

  const { codes, hashes } = await generateBackupCodes();

  if (mode === "admin") {
    const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });
    if (!settings || !(await verifyPassword(password, settings.adminPasswordHash))) {
      return NextResponse.json({ ok: false, error: "Contraseña de administrador incorrecta." }, { status: 401 });
    }
    await prisma.platformSettings.update({
      where: { id: "singleton" },
      data: { adminTwoFactorEnabled: true, adminTwoFactorSecret: secret, adminTwoFactorBackupCodes: hashes },
    });
    return NextResponse.json({ ok: true, backupCodes: codes });
  }

  const uname = (username ?? "").trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { username: { equals: uname, mode: "insensitive" } },
    select: { id: true, passwordHash: true, isActive: true, deptId: true, department: { select: { code: true } } },
  });
  if (!user || !user.isActive || !user.deptId || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ ok: false, error: "Usuario o contraseña incorrectos." }, { status: 401 });
  }
  if (!user.department || !TWO_FACTOR_REQUIRED_DEPT_CODES.includes(user.department.code)) {
    return NextResponse.json({ ok: false, error: "Este usuario no requiere autenticador." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: true, twoFactorSecret: secret, twoFactorBackupCodes: hashes },
  });
  return NextResponse.json({ ok: true, backupCodes: codes });
}
