import { TopLine } from "@/components/ui/TopLine";
import { FernickPanel } from "@/components/shell/FernickPanel";

export default function AdminFernickPage() {
  return (
    <div>
      <TopLine eyebrow="Estrategia" title="FERNICK" />
      <FernickPanel />
    </div>
  );
}
