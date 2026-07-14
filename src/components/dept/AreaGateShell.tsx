"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { BrandMark } from "@/components/brand/DaflowMark";
import { EmployeeSidebar } from "@/components/shell/EmployeeSidebar";
import { TopBanner } from "@/components/shell/TopBanner";
import { UpdateGate } from "@/components/dept/UpdateGate";
import { LeaderBanner } from "@/components/dept/LeaderBanner";
import { signOut } from "next-auth/react";
import type { ProcessDTO } from "@/components/process/ProcessEditor";
import { isFutureDate } from "@/lib/time";

type PendingUpdate = { id: string; processId: string; processTitle: string; createdAt: string };
type LeaderAlert = { id: string; processTitle: string; pendingCount: number; teamSize: number };

export function AreaGateShell({
  deptName,
  userName,
  userPhotoUrl,
  logoUrl,
  bannerUrl,
  pendingUpdates,
  activeProcess,
  snoozeUntil,
  leaderAlerts,
  ledDeptName,
  showSuppliers = false,
  pendingSuppliersCount = 0,
  children,
}: {
  deptName: string;
  userName: string;
  userPhotoUrl?: string | null;
  logoUrl: string | null | undefined;
  bannerUrl?: string | null;
  pendingUpdates: PendingUpdate[];
  activeProcess: ProcessDTO | null;
  snoozeUntil: string | null;
  leaderAlerts: LeaderAlert[];
  ledDeptName: string | null;
  showSuppliers?: boolean;
  pendingSuppliersCount?: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [snoozedNow, setSnoozedNow] = useState(false);

  const isSnoozed = isFutureDate(snoozeUntil);
  const activeUpdate = pendingUpdates.find((u) => !dismissedIds.has(u.id));
  const showGate = !!activeUpdate && !isSnoozed && !snoozedNow;

  if (showGate && activeUpdate) {
    return (
      <div className="flex h-screen min-h-0">
        <div className="w-[230px] shrink-0 bg-navy text-[#EDEFE9] flex flex-col min-h-0">
          <div className="px-4.5 pt-5 pb-3.5 border-b border-white/10">
            <div className="flex items-center gap-2.5 mb-3">
              <BrandMark logoUrl={logoUrl} size={26} light chip={!!logoUrl} />
              <span className="font-display font-bold text-[15px] text-white">DAFLOW</span>
            </div>
            <div className="flex items-center gap-2.5">
              {userPhotoUrl && (
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-teal/70 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={userPhotoUrl} alt={userName} className="w-full h-full object-cover object-top" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-[10px] tracking-[.14em] uppercase text-teal">Área</div>
                <h1 className="text-[17px] font-bold mt-0.5 truncate">{deptName}</h1>
                {userName && <div className="text-[11.5px] text-[#B9C2CC] truncate">{userName}</div>}
              </div>
            </div>
          </div>
          <div className="px-4.5 py-3.5 border-t border-white/10 mt-auto">
            <button
              type="button"
              className="flex items-center gap-2 text-[#C9CFC5] hover:text-white text-[12.5px] cursor-pointer"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut size={14} /> Cerrar sesión
            </button>
          </div>
        </div>
        <main className="flex-1 overflow-y-auto bg-bg p-9">
          <UpdateGate
            updateId={activeUpdate.id}
            processTitle={activeUpdate.processTitle}
            createdAt={activeUpdate.createdAt}
            process={activeProcess}
            remaining={pendingUpdates.length}
            onAck={() => router.refresh()}
            onSnooze={() => setSnoozedNow(true)}
            onDismissSession={() => setDismissedIds((prev) => new Set(prev).add(activeUpdate.id))}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0">
      <EmployeeSidebar
        deptName={deptName}
        userName={userName}
        userPhotoUrl={userPhotoUrl}
        logoUrl={logoUrl}
        showSuppliers={showSuppliers}
        pendingSuppliersCount={pendingSuppliersCount}
      />
      <main className="flex-1 overflow-y-auto bg-bg p-9">
        <TopBanner bannerUrl={bannerUrl} />
        {ledDeptName && <LeaderBanner deptName={ledDeptName} alerts={leaderAlerts} />}
        {children}
      </main>
    </div>
  );
}
