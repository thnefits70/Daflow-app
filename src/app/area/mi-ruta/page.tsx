import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TopLine } from "@/components/ui/TopLine";
import { MyLearningPaths } from "@/components/learningPaths/MyLearningPaths";
import { getMyLearningPaths } from "@/lib/learningPaths";

export default async function MiRutaPage() {
  const session = await auth();
  if (!session || session.user.role !== "employee") redirect("/login");

  const paths = await getMyLearningPaths(session.user.id);

  return (
    <div>
      <TopLine eyebrow="DAFLOW" title="Mi ruta de conocimiento" />
      <MyLearningPaths initialPaths={paths} />
    </div>
  );
}
