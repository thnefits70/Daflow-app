import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TopLine } from "@/components/ui/TopLine";
import { PersonalPurchasesPanel } from "@/components/personal-purchases/PersonalPurchasesPanel";

export default async function ComprasPersonalesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div>
      <TopLine eyebrow="Recursos humanos" title="Compras personales" />
      <PersonalPurchasesPanel />
    </div>
  );
}
