// Pure helpers for Servicio Postventa — no prisma import, so this can be
// imported from client components (StoreFeedbackPanel) as well as
// server-side data assembly, same separation as financeKpisCalc.ts.

// Confirmado 2026-07-24: enfoque de retención de cliente — Provedix es
// proveedor y las tiendas (con venta pautada en Meta/TikTok) son sus
// clientes. El semáforo se deriva de loyaltyScore (1-5, "¿seguirá
// comprándonos?", 5 = excelente — confirmado 2026-07-25 igual que el resto
// de indicadores) en vez de pedirle a Nairoby que lo elija a mano — mismo
// patrón de bandas derivadas que el resto de KPIs de la app.
export type RetentionRisk = { cls: "strong" | "stable" | "at_risk"; label: string; icon: string; color: string };

export function retentionRiskFor(loyaltyScore: number): RetentionRisk {
  if (loyaltyScore >= 5) return { cls: "strong", label: "Fuerte", icon: "🟢", color: "#14C7C7" };
  if (loyaltyScore >= 3) return { cls: "stable", label: "Estable", icon: "🟡", color: "#D9A441" };
  return { cls: "at_risk", label: "En riesgo", icon: "🔴", color: "#C4453A" };
}
