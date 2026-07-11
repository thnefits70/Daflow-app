import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export default async function SettingsPage() {
  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });

  return (
    <div>
      <TopLine eyebrow="Configuración" title="Marca de la plataforma" />
      <SettingsPanel
        logoUrl={settings?.logoUrl ?? null}
        bannerUrl={settings?.bannerUrl ?? null}
        adminEmail={settings?.adminEmail ?? null}
      />
    </div>
  );
}
