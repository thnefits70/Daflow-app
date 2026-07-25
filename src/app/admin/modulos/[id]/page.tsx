import { notFound } from "next/navigation";
import { ModuleDetail } from "@/components/modules/ModuleDetail";
import { getModule } from "@/lib/modules";

export default async function AdminModuleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const module_ = await getModule(id);
  if (!module_) notFound();

  return (
    <ModuleDetail
      module={module_}
      documents={module_.documents}
      editable
      basePath="/admin/modulos"
    />
  );
}
