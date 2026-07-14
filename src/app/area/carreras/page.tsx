import { Rocket } from "lucide-react";
import { TopLine } from "@/components/ui/TopLine";

export default function AreaCarrerasPage() {
  return (
    <div>
      <TopLine eyebrow="Crecimiento del equipo" title="Carreras y Habilidades" />
      <div className="border-[1.5px] border-dashed border-rule rounded-md p-10 text-center">
        <Rocket size={22} className="mx-auto mb-3 text-steel" />
        <div className="text-[14px] font-semibold mb-1.5">Próximamente</div>
        <div className="text-[13px] text-steel max-w-md mx-auto">
          Aquí vas a poder ver rutas de carrera con exámenes y habilidades para seguir creciendo dentro de tu área.
        </div>
      </div>
    </div>
  );
}
