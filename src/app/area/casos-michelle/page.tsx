import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { TopLine } from "@/components/ui/TopLine";
import { TabGuide } from "@/components/shared/TabGuide";
import { getCasesRole } from "@/lib/provedixCases";
import { MichelleCasesPanel } from "@/components/provedix/MichelleCasesPanel";

// Casos de Michelle IA (provedix.com) para Michelle, la asesora humana (pedido del usuario 2026-10-15).
export default async function CasosMichellePage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await getCasesRole())) notFound();
  return (
    <div>
      <TopLine eyebrow="provedix.com" title="Casos de Michelle IA" />
      <TabGuide storageKey="casos-michelle">
        Michelle IA atiende a los dropshippers en el chat de provedix.com y
        resuelve casi todo sola. Aquí llega solo lo que ella no pudo resolver,
        con un resumen y la conversación completa: el dropshipper te escribe por
        WhatsApp con el código del caso (MC-0001), así no tienes que volver a
        preguntar nada. Cuando lo resuelvas, márcalo y, si fue una duda que se
        puede repetir, enséñale la respuesta a Michelle IA para que la próxima
        vez la resuelva sola.
      </TabGuide>
      <MichelleCasesPanel />
    </div>
  );
}
