"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LayoutDashboard, ClipboardList, Scale, LogOut } from "lucide-react";
import { BrandMark } from "@/components/brand/DaflowMark";

export function EmployeeSidebar({
  deptName,
  userName,
  logoUrl,
}: {
  deptName: string;
  userName: string;
  logoUrl?: string | null;
}) {
  const pathname = usePathname();
  const NAV_ITEM =
    "flex items-center gap-2.5 px-4.5 py-2.5 text-[13.5px] border-l-[3px] border-transparent cursor-pointer";
  const NAV_ACTIVE = "bg-blue/15 border-blue text-white";
  const NAV_INACTIVE = "text-[#C9CFC5] hover:bg-white/[.06] hover:text-white";

  return (
    <div className="w-[230px] shrink-0 bg-navy text-[#EDEFE9] flex flex-col min-h-0">
      <div className="px-4.5 pt-5 pb-3.5 border-b border-white/10">
        <div className="flex items-center gap-2.5 mb-3">
          <BrandMark logoUrl={logoUrl} size={26} light chip={!!logoUrl} />
          <span className="font-display font-bold text-[15px] text-white">DAFLOW</span>
        </div>
        <div className="text-[10px] tracking-[.14em] uppercase text-teal">Área</div>
        <h1 className="text-[17px] font-bold mt-1">{deptName}</h1>
        {userName && <div className="text-[11.5px] text-[#B9C2CC] mt-1">{userName}</div>}
      </div>

      <div className="flex-1 overflow-y-auto py-2.5 min-h-0">
        <Link href="/area" className={`${NAV_ITEM} ${pathname === "/area" ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <LayoutDashboard size={15} /> Inicio
        </Link>
        <Link href="/area/workspace" className={`${NAV_ITEM} ${pathname.startsWith("/area/workspace") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <ClipboardList size={15} /> Mi área de trabajo
        </Link>
        <Link href="/area/leyes" className={`${NAV_ITEM} ${pathname.startsWith("/area/leyes") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <Scale size={15} /> Leyes y Reglamentos
        </Link>
      </div>

      <div className="px-4.5 py-3.5 border-t border-white/10">
        <button
          type="button"
          className="flex items-center gap-2 text-[#C9CFC5] hover:text-white text-[12.5px] cursor-pointer"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut size={14} /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}
