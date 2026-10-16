import { prisma } from "@/lib/prisma";
import { LoginForm } from "@/components/login/LoginForm";

// Lee la configuración (logo, nombre) en cada visita, como siempre: desde
// 2026-10-17 el layout raíz ya no vuelve dinámica la app entera.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });
  return <LoginForm logoUrl={settings?.logoUrl ?? null} />;
}
