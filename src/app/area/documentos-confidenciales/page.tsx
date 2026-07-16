import { redirect } from "next/navigation";
import { TopLine } from "@/components/ui/TopLine";
import { ConfidentialDocsPanel } from "@/components/confidential/ConfidentialDocsPanel";
import { getConfidentialAccessCount } from "@/lib/guards";

export default async function AreaDocumentosConfidencialesPage() {
  const accessCount = await getConfidentialAccessCount();
  if (accessCount === 0) redirect("/area");

  return (
    <div>
      <TopLine eyebrow="Privado" title="Documentos Confidenciales" />
      <ConfidentialDocsPanel mode="own" />
    </div>
  );
}
