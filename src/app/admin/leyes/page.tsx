import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";

export default async function LeyesAdminPage() {
  const documents = await prisma.document.findMany({ where: { isLaw: true }, orderBy: { createdAt: "asc" } });

  return (
    <div>
      <TopLine eyebrow="Cumplimiento" title="Leyes y Reglamentos" />
      <DocumentsPanel
        isLaw
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
