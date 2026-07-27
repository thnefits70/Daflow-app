import { TopLine } from "@/components/ui/TopLine";
import { LearningPathsAdmin } from "@/components/learningPaths/LearningPathsAdmin";
import { listLearningPaths } from "@/lib/learningPaths";

export default async function RutasConocimientoPage() {
  const paths = await listLearningPaths();

  return (
    <div>
      <TopLine eyebrow="DAFLOW · Administrador" title="Rutas de conocimiento" />
      <div className="text-[13px] text-steel max-w-2xl mb-4.5">
        Arma una ruta de aprendizaje escogiendo contenido que ya existe en DAFLOW, deja que la IA sugiera las
        preguntas de verificación, y asígnala a quien tú decidas — sin importar el puesto formal que tenga en Nómina.
      </div>
      <LearningPathsAdmin initialPaths={paths} />
    </div>
  );
}
