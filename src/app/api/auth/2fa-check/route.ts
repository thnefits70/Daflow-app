import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import {
  TWO_FACTOR_REQUIRED_DEPT_CODES,
  generateTwoFactorSecret,
  twoFactorOtpauthUrl,
  twoFactorQrDataUrl,
} from "@/lib/twoFactor";

const schema = z.object({
  mode: z.enum(["admin", "team"]),
  username: z.string().trim().optional(),
  password: z.string(),
});

// Primer paso del login: valida la contraseña (sin crear sesión todavía) y
// le dice al formulario qué mostrar después — nada más, pedir el código, o
// primero mostrarle el QR porque es su primera vez. El segundo paso real
// (signIn de next-auth) vuelve a validar contraseña + código desde cero en
// auth.ts, así que esta ruta nunca es, por sí sola, suficiente para entrar.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Datos inválidos." }, { status: 400 });
  const { mode, username, password } = parsed.data;

  if (mode === "admin") {
    const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });
    if (!settings || !(await verifyPassword(password, settings.adminPasswordHash))) {
      return NextResponse.json({ ok: false, error: "Contraseña de administrador incorrecta." }, { status: 401 });
    }
    if (!settings.adminTwoFactorEnabled) {
      return NextResponse.json({ ok: true, totpRequired: false });
    }
    return NextResponse.json({ ok: true, totpRequired: true, enroll: false });
  }

  const uname = (username ?? "").trim().toLowerCase();
  if (!uname) return NextResponse.json({ ok: false, error: "Usuario o contraseña incorrectos." }, { status: 401 });

  const user = await prisma.user.findFirst({
    where: { username: { equals: uname, mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      passwordHash: true,
      isActive: true,
      deptId: true,
      twoFactorEnabled: true,
      department: { select: { code: true } },
    },
  });
  if (!user || !user.isActive || !user.deptId || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ ok: false, error: "Usuario o contraseña incorrectos." }, { status: 401 });
  }

  const requiresTwoFactor = !!user.department && TWO_FACTOR_REQUIRED_DEPT_CODES.includes(user.department.code);
  if (!requiresTwoFactor) {
    return NextResponse.json({ ok: true, totpRequired: false });
  }

  if (user.twoFactorEnabled) {
    return NextResponse.json({ ok: true, totpRequired: true, enroll: false });
  }

  // Primera vez: genera un secreto NUEVO (no se guarda hasta que confirme el
  // código en /api/auth/2fa-enroll-confirm) y el QR para escanearlo.
  const secret = generateTwoFactorSecret();
  const otpauthUrl = twoFactorOtpauthUrl(`${user.name} (DAFLOW)`, secret);
  const qrDataUrl = await twoFactorQrDataUrl(otpauthUrl);
  return NextResponse.json({ ok: true, totpRequired: true, enroll: true, secret, qrDataUrl });
}
