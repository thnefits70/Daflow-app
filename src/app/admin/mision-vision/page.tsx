import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";

export default async function MisionVisionAdminPage() {
  const documents = await prisma.document.findMany({ where: { isMissionVision: true }, orderBy: { createdAt: "asc" } });

  return (
    <div>
      <TopLine eyebrow="DAFLOW" title="Misión y Visión" />
      <DocumentsPanel
        isMissionVision
        editable
        documents={documents.map((d) => ({
          id: d.id,
          title: d.title,
          content: d.content,
          link: d.link,
          fileUrl: d.fileUrl,
          fileName: d.fileName,
        }))}
      />
    </div>
  );
}
