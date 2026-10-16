import { redirect } from "next/navigation";
import { TopLine } from "@/components/ui/TopLine";
import { NickPanel } from "@/components/nick/NickPanel";
import { canAccessNick } from "@/lib/guards";
import { getNickAccounts } from "@/lib/nick/accounts";

// Solo quien tenga "Acceso a NICK" prendido por el admin en Nómina.
export default async function AreaNickPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  if (!(await canAccessNick())) redirect("/area");
  const accounts = await getNickAccounts();
  return (
    <div>
      <TopLine eyebrow="Seguimiento de guías en Dropi" title="NICK" />
      <NickPanel accounts={accounts} notice={{ ok: sp.ok, error: sp.error }} />
    </div>
  );
}
