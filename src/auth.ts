import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import {
  verifyTwoFactorCode,
  consumeBackupCode,
  looksLikeTotpCode,
  verifyEnrollToken,
  TWO_FACTOR_REQUIRED_DEPT_CODES,
} from "@/lib/twoFactor";

// Valida un código de 2FA contra un secreto + lista de códigos de respaldo
// ya guardados. Si el match viene de un código de respaldo, avisa cuál
// hash quedó consumido (el caller debe persistir la lista sin ese hash —
// un código de respaldo sirve una sola vez).
async function checkTwoFactorCode(
  code: string | undefined,
  secret: string | null,
  backupHashes: string[]
): Promise<{ ok: boolean; remainingBackupHashes?: string[] }> {
  if (!code || !secret) return { ok: false };
  if (looksLikeTotpCode(code)) {
    return { ok: verifyTwoFactorCode(code, secret) };
  }
  const remaining = await consumeBackupCode(code, backupHashes);
  if (remaining === null) return { ok: false };
  return { ok: true, remainingBackupHashes: remaining };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        mode: { label: "Modo", type: "text" },
        username: { label: "Usuario", type: "text" },
        password: { label: "Contraseña", type: "password" },
        totp: { label: "Código", type: "text" },
        enrollToken: { label: "EnrollToken", type: "text" },
      },
      authorize: async (raw) => {
        const mode = raw?.mode as string | undefined;
        const password = raw?.password as string | undefined;
        const totp = raw?.totp as string | undefined;
        const enrollToken = raw?.enrollToken as string | undefined;
        if (!password) return null;

        if (mode === "admin") {
          const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });
          if (!settings) return null;
          const ok = await verifyPassword(password, settings.adminPasswordHash);
          if (!ok) return null;

          if (settings.adminTwoFactorEnabled) {
            // El paso "Ya los guardé, continuar" (justo después de activar el
            // autenticador) manda un enrollToken en vez de un código TOTP —
            // ese código ya se verificó una vez para llegar hasta acá, y
            // reenviarlo fallaba por vencido (ver twoFactor.ts).
            const enrollOk = enrollToken ? verifyEnrollToken(enrollToken, "admin", "admin") : false;
            if (!enrollOk) {
              const check = await checkTwoFactorCode(totp, settings.adminTwoFactorSecret, settings.adminTwoFactorBackupCodes);
              if (!check.ok) return null;
              if (check.remainingBackupHashes) {
                await prisma.platformSettings.update({
                  where: { id: "singleton" },
                  data: { adminTwoFactorBackupCodes: check.remainingBackupHashes },
                });
              }
            }
          }

          return { id: "admin", name: "Administrador", role: "admin" };
        }

        const username = (raw?.username as string | undefined)?.trim().toLowerCase();
        if (!username) return null;

        const user = await prisma.user.findFirst({
          where: { username: { equals: username, mode: "insensitive" } },
          include: { department: { select: { code: true } } },
        });
        if (!user) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;
        if (!user.deptId) return null;
        if (!user.isActive) return null;

        const requiresTwoFactor = !!user.department && TWO_FACTOR_REQUIRED_DEPT_CODES.includes(user.department.code);
        if (requiresTwoFactor) {
          // Sin secreto guardado todavía: el frontend debe pasar primero por
          // el enroll (2fa-enroll-confirm), que lo guarda antes de llegar
          // acá — si por algún motivo llega sin eso, no se deja entrar.
          if (!user.twoFactorEnabled || !user.twoFactorSecret) return null;
          const enrollOk = enrollToken ? verifyEnrollToken(enrollToken, "team", user.id) : false;
          if (!enrollOk) {
            const check = await checkTwoFactorCode(totp, user.twoFactorSecret, user.twoFactorBackupCodes);
            if (!check.ok) return null;
            if (check.remainingBackupHashes) {
              await prisma.user.update({
                where: { id: user.id },
                data: { twoFactorBackupCodes: check.remainingBackupHashes },
              });
            }
          }
        }

        return {
          id: user.id,
          name: user.name,
          role: "employee",
          deptId: user.deptId,
          username: user.username,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.deptId = user.deptId ?? null;
        token.username = user.username ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub ?? "";
      session.user.role = token.role ?? "employee";
      session.user.deptId = token.deptId ?? null;
      session.user.username = token.username ?? null;
      return session;
    },
  },
});
