import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { looksLikeTotpCode, verifyTwoFactorCode, consumeBackupCode } from "@/lib/twoFactor";

// Segundo factor para acciones delicadas ya autenticadas como admin (ej.
// eliminar un área): vuelve a pedir la contraseña del admin y, si tiene el
// autenticador activado, su código TOTP o uno de sus códigos de respaldo.
// Reutiliza el mismo PlatformSettings.adminPasswordHash/adminTwoFactorSecret
// del login — no es una sesión nueva, es una reconfirmación puntual.
export async function verifyAdminStepUp(password: string, code: string | undefined) {
  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) return { ok: false as const, error: "No se pudo verificar: configuración no encontrada." };

  if (!password || !(await verifyPassword(password, settings.adminPasswordHash))) {
    return { ok: false as const, error: "Contraseña incorrecta." };
  }

  if (!settings.adminTwoFactorEnabled) return { ok: true as const };

  const trimmed = (code ?? "").trim();
  if (!trimmed) return { ok: false as const, error: "Falta el código del autenticador." };

  if (looksLikeTotpCode(trimmed)) {
    if (!settings.adminTwoFactorSecret || !verifyTwoFactorCode(trimmed, settings.adminTwoFactorSecret)) {
      return { ok: false as const, error: "Código del autenticador incorrecto." };
    }
    return { ok: true as const };
  }

  const remaining = await consumeBackupCode(trimmed, settings.adminTwoFactorBackupCodes);
  if (!remaining) return { ok: false as const, error: "Código de respaldo incorrecto o ya usado." };

  await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { adminTwoFactorBackupCodes: remaining },
  });
  return { ok: true as const };
}
