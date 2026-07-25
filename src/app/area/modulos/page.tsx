import { TopLine } from "@/components/ui/TopLine";
import { ModulesGrid } from "@/components/modules/ModulesGrid";
import { getModules } from "@/lib/modules";

export default async function AreaModulosPage() {
  const modules = await getModules();

  return (
    <div>
      <TopLine eyebrow="DAFLOW" title="Módulos" />
      <ModulesGrid modules={modules} editable={false} basePath="/area/modulos" />
    </div>
  );
}
