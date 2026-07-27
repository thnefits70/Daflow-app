// Pure (no prisma import) — safe for client components. Confirmado
// 2026-07-26: en vez de pedir una imagen de portada para cada módulo, se
// asigna automáticamente un símbolo según palabras clave en el título — el
// admin puede seguir subiendo una imagen propia si quiere, pero ya no hace
// falta buscarla.
import {
  BookOpen,
  HeartHandshake,
  Compass,
  Settings,
  ShieldCheck,
  TrendingUp,
  Wallet,
  Scale,
  GraduationCap,
  Rocket,
  Truck,
  Megaphone,
  Users,
  type LucideIcon,
} from "lucide-react";

type ModuleIconMatch = { keywords: string[]; icon: LucideIcon; color: string };

const MATCHERS: ModuleIconMatch[] = [
  { keywords: ["induccion", "onboarding", "bienvenida"], icon: HeartHandshake, color: "#14C7C7" },
  { keywords: ["mision", "vision", "valores"], icon: Compass, color: "#1E5EFF" },
  { keywords: ["garantia", "postventa"], icon: ShieldCheck, color: "#14C7C7" },
  { keywords: ["manual", "operacion", "procedimiento", "proceso"], icon: Settings, color: "#D9A441" },
  { keywords: ["venta", "comercial", "cliente"], icon: TrendingUp, color: "#1E5EFF" },
  { keywords: ["finanza", "contab", "presupuesto"], icon: Wallet, color: "#D9A441" },
  { keywords: ["reglamento", "normativa", "politica", "ley"], icon: Scale, color: "#8ea0bd" },
  { keywords: ["capacitacion", "entrenamiento", "curso"], icon: GraduationCap, color: "#14C7C7" },
  { keywords: ["carrera", "habilidad"], icon: Rocket, color: "#1E5EFF" },
  { keywords: ["logistica", "bodega", "inventario"], icon: Truck, color: "#D9A441" },
  { keywords: ["marketing", "publicidad", "marca"], icon: Megaphone, color: "#1E5EFF" },
  { keywords: ["equipo", "cultura", "talento"], icon: Users, color: "#14C7C7" },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function iconForModule(title: string): { Icon: LucideIcon; color: string } {
  const n = normalize(title);
  for (const m of MATCHERS) {
    if (m.keywords.some((k) => n.includes(k))) return { Icon: m.icon, color: m.color };
  }
  return { Icon: BookOpen, color: "#8ea0bd" };
}
