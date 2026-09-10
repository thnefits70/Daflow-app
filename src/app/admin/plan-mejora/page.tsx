import { TopLine } from "@/components/ui/TopLine";
import { ImprovementPlanAdminPanel } from "@/components/improvement-plan/ImprovementPlanAdminPanel";

export default function AdminImprovementPlanPage() {
  return (
    <div>
      <TopLine eyebrow="Personas" title="Plan de Mejora y Acompañamiento" />
      <div className="text-[13px] text-steel mb-5 max-w-2xl">
        Tablero global de todos los planes de mejora abiertos por los líderes de cada área — aprueba o rechaza los
        cierres delicados (Reubicación / Revisión de continuidad) que quedan pendientes de tu revisión.
      </div>
      <ImprovementPlanAdminPanel />
    </div>
  );
}
