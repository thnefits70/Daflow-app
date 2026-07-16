"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  ShieldCheck,
  Users as UsersIcon,
  Scale,
  Settings,
  Building2,
  GripVertical,
  LogOut,
  Sparkles,
  Truck,
  Rocket,
  Wallet,
  FolderLock,
  Menu,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/brand/DaflowMark";

type Department = { id: string; name: string; code: string };

const NAV_ITEM =
  "flex items-center gap-2.5 px-4.5 py-2.5 text-[13.5px] rounded-none border-l-[3px] border-transparent cursor-pointer overflow-hidden whitespace-nowrap text-ellipsis";
// Department rows can have long names, so they wrap onto up to two lines instead of
// truncating — laid out top-aligned since the row height now varies.
const NAV_ITEM_DEPT =
  "flex items-start gap-2.5 px-4.5 py-2.5 text-[13.5px] rounded-none border-l-[3px] border-transparent cursor-pointer";
const NAV_ACTIVE = "bg-blue/15 border-blue text-white";
const NAV_INACTIVE = "text-[#C9CFC5] hover:bg-white/[.06] hover:text-white";

export function AdminSidebar({
  departments,
  specialDepartments,
  logoUrl,
  pendingSuppliersCount = 0,
}: {
  departments: Department[];
  specialDepartments: Department[];
  logoUrl?: string | null;
  pendingSuppliersCount?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [list, setList] = useState(departments);
  const [prevDepartments, setPrevDepartments] = useState(departments);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  if (departments !== prevDepartments) {
    setPrevDepartments(departments);
    setList(departments);
  }

  const reorder = async (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx === null) return;
    const next = [...list];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setList(next);
    setSaving(true);
    await fetch("/api/departments/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((d) => d.id) }),
    });
    setSaving(false);
    router.refresh();
  };

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

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
        <div className="text-[10px] tracking-[.14em] uppercase text-teal">Panel</div>
        <h1 className="text-[17px] font-bold mt-1">Administrador</h1>
      </div>

      <div className="flex-1 overflow-y-auto py-2.5 min-h-0" onClick={() => setOpen(false)}>
        <Link href="/admin" className={`${NAV_ITEM} ${isActive("/admin") && pathname === "/admin" ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <LayoutDashboard size={15} /> Inicio
        </Link>
        <Link href="/admin/areas" className={`${NAV_ITEM} ${pathname.startsWith("/admin/areas") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <ShieldCheck size={15} /> Áreas del negocio
        </Link>

        {specialDepartments.map((d) => (
          <Link
            key={d.id}
            href={`/admin/dept/${d.id}`}
            className={`${NAV_ITEM_DEPT} ${pathname.startsWith(`/admin/dept/${d.id}`) ? NAV_ACTIVE : NAV_INACTIVE}`}
          >
            <Sparkles size={15} className="shrink-0 mt-0.5" />
            <span className="leading-snug line-clamp-2 break-words">{d.name}</span>
          </Link>
        ))}

        <Link href="/admin/nomina" className={`${NAV_ITEM} ${pathname.startsWith("/admin/nomina") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <UsersIcon size={15} /> Nómina
        </Link>
        <Link href="/admin/roles-de-pago" className={`${NAV_ITEM} ${pathname.startsWith("/admin/roles-de-pago") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <Wallet size={15} /> Roles de pago
        </Link>
        <Link href="/admin/leyes" className={`${NAV_ITEM} ${pathname.startsWith("/admin/leyes") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <Scale size={15} /> Leyes y Reglamentos
        </Link>
        <Link href="/admin/carreras" className={`${NAV_ITEM} ${pathname.startsWith("/admin/carreras") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <Rocket size={15} /> Carreras y Habilidades
        </Link>

        {list.map((d, idx) => (
          <div
            key={d.id}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              reorder(dragIdx ?? idx, idx);
              setDragIdx(null);
            }}
            onDragEnd={() => setDragIdx(null)}
            className={dragIdx === idx ? "opacity-40" : ""}
          >
            <Link
              href={`/admin/dept/${d.id}`}
              className={`${NAV_ITEM_DEPT} cursor-grab ${pathname.startsWith(`/admin/dept/${d.id}`) ? NAV_ACTIVE : NAV_INACTIVE}`}
            >
              <GripVertical size={13} className="opacity-50 shrink-0 mt-1" />
              <Building2 size={15} className="shrink-0 mt-0.5" />
              <span className="min-w-0">
                <span className="block leading-snug line-clamp-2 break-words">{d.name}</span>
                <span className="block font-mono text-[10px] opacity-65 mt-0.5">{d.code}</span>
              </span>
            </Link>
          </div>
        ))}

        <Link href="/admin/proveedores" className={`${NAV_ITEM} ${pathname.startsWith("/admin/proveedores") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <Truck size={15} /> Proveedores
          {pendingSuppliersCount > 0 && (
            <span className="ml-auto font-mono text-[10px] font-semibold bg-red/20 text-red rounded-full px-1.5 py-0.5">
              {pendingSuppliersCount}
            </span>
          )}
        </Link>
        <Link href="/admin/documentos-confidenciales" className={`${NAV_ITEM} ${pathname.startsWith("/admin/documentos-confidenciales") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <FolderLock size={15} /> Documentos Confidenciales
        </Link>
        <Link href="/admin/settings" className={`${NAV_ITEM} ${pathname.startsWith("/admin/settings") ? NAV_ACTIVE : NAV_INACTIVE}`}>
          <Settings size={15} /> Configuración
        </Link>
      </div>

      <div className="px-4.5 py-3.5 border-t border-white/10">
        {saving && <div className="text-[10.5px] text-[#B9C2CC] mb-2">Guardando orden…</div>}
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
