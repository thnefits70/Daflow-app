import { TopLine } from "@/components/ui/TopLine";
import { NickPanel } from "@/components/nick/NickPanel";
import { getNickAccounts } from "@/lib/nick/accounts";

// AdminLayout ya exige role === "admin" para todo /admin/*.
export default async function AdminNickPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const accounts = await getNickAccounts();
  return (
    <div>
      <TopLine eyebrow="Seguimiento de guías en Dropi" title="NICK" />
      <NickPanel accounts={accounts} isAdmin notice={{ ok: sp.ok, error: sp.error }} />
    </div>
  );
}
