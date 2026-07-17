import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

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
      },
      authorize: async (raw) => {
        const mode = raw?.mode as string | undefined;
        const password = raw?.password as string | undefined;
        if (!password) return null;

        if (mode === "admin") {
          const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });
          if (!settings) return null;
          const ok = await verifyPassword(password, settings.adminPasswordHash);
          if (!ok) return null;
          return { id: "admin", name: "Administrador", role: "admin" };
        }

        const username = (raw?.username as string | undefined)?.trim().toLowerCase();
        if (!username) return null;

        const user = await prisma.user.findFirst({
          where: { username: { equals: username, mode: "insensitive" } },
        });
        if (!user) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;
        if (!user.deptId) return null;
        if (!user.isActive) return null;

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
