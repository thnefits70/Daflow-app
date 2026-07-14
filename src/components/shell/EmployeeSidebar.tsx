"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LayoutDashboard, ClipboardList, Scale, LogOut, Truck, Rocket, Wallet, Menu, X } from "lucide-react";
import { BrandMark } from "@/components/brand/DaflowMark";

export function EmployeeSidebar({
  deptName,
  userName,
  userPhotoUrl,
  logoUrl,
  showSuppliers = false,
  pendingSuppliersCount = 0,
  unseenFeedbackCount = 0,
  unseenPayStubCount = 0,
}: {
  deptName: string;
  userName: string;
  userPhotoUrl?: string | null;
  logoUrl?: string | null;
  showSuppliers?: boolean;
  pendingSuppliersCount?: number;
  unseenFeedbackCount?: number;
  unseenPayStubCount?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const NAV_ITEM =
    "flex items-center gap-2.5 px-4.5 py-2.5 text-[13.5px] border-l-[3px] border-transparent cursor-pointer";
  const NAV_ACTIVE = "bg-blue/15 border-blue text-white";
  const NAV_INACTIVE = "text-[#C9CFC5] hover:bg-white/[.06] hover:text-white";

  return (
    <>
      <div className="md:hidden flex items-center justify-between gap-2 px-4 py-3 bg-navy text-white border-b border-white/10">
        <div className="flex items-center gap-2">
          <BrandMark logoUrl={logoUrl} size={22} light chip={!!logoUrl} />
          <span className="font-display font-bold text-[14px]">DAFLOW</span>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="p-1.5 text-white cursor-pointer" aria-label="Abrir menú">
          <Menu size={20} />
        </button>
      </div>

      {open && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setOpen(false)} />}

      <div
        className={`fixed md:static inset-y-0 left-0 z-40 w-[230px] shrink-0 bg-navy text-[#EDEFE9] flex flex-col min-h-0 transform transition-transform duration-200 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
      <div className="px-4.5 pt-5 pb-3.5 border-b border-white/10">
        <div className="flex items-center justify-between gap-2.5 mb-3">
          <div className="flex items-center gap-2.5">
            <BrandMark logoUrl={logoUrl} size={26} light chip={!!logoUrl} />
            <span className="font-display font-bold text-[15px] text-white">DAFLOW</span>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="md:hidden p-1 text-white cursor-pointer" aria-label="Cerrar menú">
            <X size={18} />
          </button>
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

      <div className="flex-1 overflow-y-auto py-2.5 min-h-0" onClick={() => setOpen(false)}>
        <Link href="/area" className={`${NAV_ITEM} ${pathname === "/area" ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <LayoutDashboard size={15} /> Inicio
        </Link>
        <Link href="/area/workspace" className={`${NAV_ITEM} ${pathname.startsWith("/area/workspace") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <ClipboardList size={15} /> Mi área de trabajo
          {unseenFeedbackCount > 0 && (
            <span className="ml-auto font-mono text-[10px] font-semibold bg-red/20 text-red rounded-full px-1.5 py-0.5">
              {unseenFeedbackCount}
            </span>
          )}
        </Link>
        <Link href="/area/leyes" className={`${NAV_ITEM} ${pathname.startsWith("/area/leyes") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <Scale size={15} /> Leyes y Reglamentos
        </Link>
        <Link href="/area/carreras" className={`${NAV_ITEM} ${pathname.startsWith("/area/carreras") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <Rocket size={15} /> Carreras y Habilidades
        </Link>
        <Link href="/area/roles-de-pago" className={`${NAV_ITEM} ${pathname.startsWith("/area/roles-de-pago") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <Wallet size={15} /> Roles de pago
          {unseenPayStubCount > 0 && (
            <span className="ml-auto font-mono text-[10px] font-semibold bg-red/20 text-red rounded-full px-1.5 py-0.5">
              {unseenPayStubCount}
            </span>
          )}
        </Link>
        {showSuppliers && (
          <Link href="/area/proveedores" className={`${NAV_ITEM} ${pathname.startsWith("/area/proveedores") ? NAV_ACTIVE : NAV_INACTIVE}`}>
            <Truck size={15} /> Proveedores
            {pendingSuppliersCount > 0 && (
              <span className="ml-auto font-mono text-[10px] font-semibold bg-red/20 text-red rounded-full px-1.5 py-0.5">
                {pendingSuppliersCount}
              </span>
            )}
          </Link>
        )}
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
    </>
  );
}
