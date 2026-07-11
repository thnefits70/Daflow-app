import { prisma } from "@/lib/prisma";
import { LoginForm } from "@/components/login/LoginForm";

export default async function LoginPage() {
  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });
  return <LoginForm logoUrl={settings?.logoUrl ?? null} />;
}
