import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";

export default async function LeyesAreaPage() {
  const session = await auth();
  const [documents, currentUser] = await Promise.all([
    prisma.document.findMany({ where: { isLaw: true }, orderBy: { createdAt: "asc" } }),
    session?.user.id
      ? prisma.user.findUnique({ where: { id: session.user.id }, select: { canManageLaws: true } })
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <TopLine eyebrow="Cumplimiento" title="Leyes y Reglamentos" />
      <DocumentsPanel
        isLaw
        editable={!!currentUser?.canManageLaws}
        canDelete={false}
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
