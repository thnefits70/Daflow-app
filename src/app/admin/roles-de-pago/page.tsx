import { Wallet } from "lucide-react";
import { TopLine } from "@/components/ui/TopLine";

export default function AdminRolesDePagoPage() {
  return (
    <div>
      <TopLine eyebrow="Nómina" title="Roles de pago" />
      <div className="border-[1.5px] border-dashed border-rule rounded-md p-10 text-center">
        <Wallet size={22} className="mx-auto mb-3 text-steel" />
        <div className="text-[14px] font-semibold mb-1.5">Próximamente</div>
        <div className="text-[13px] text-steel max-w-md mx-auto">
          Aquí vas a poder gestionar los roles de pago del equipo.
        </div>
      </div>
    </div>
  );
}
