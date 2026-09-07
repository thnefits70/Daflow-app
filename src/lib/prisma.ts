import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Confirmado 2026-09-07 — causa real de DOS caídas de producción seguidas
// el mismo día. Cada instancia serverless de Vercel abre su propio pool
// hacia Supavisor (el "portero" de conexiones de Supabase, puerto 6543).
// El límite de 200 que se ve en el error NO es de la base de datos real
// (medido directo con pg_stat_activity: apenas ~20 conexiones reales en el
// peor momento) — es cuántas conexiones de CLIENTE (o sea, de Vercel)
// Supavisor acepta a la vez. Bajo tráfico alto, Vercel levanta muchas
// instancias en paralelo, y cada una retiene sus conexiones mientras sigue
// "tibia" entre pedidos (no se cierran solas — una función serverless
// "congelada" ni siquiera puede correr su propio temporizador de limpieza
// mientras está pausada, así que idleTimeoutMillis no alcanza a actuar).
// Un primer intento con `max: 3` no fue suficiente — con suficientes
// instancias vivas a la vez, 3 cada una todavía sumaba más de 200. `max: 1`
// es lo que Prisma recomienda para serverless + pooler de este tipo: cada
// instancia solo necesita una conexión a la vez (una function no atiende
// dos pedidos en simultáneo), así que aunque haya cien instancias vivas al
// mismo tiempo, la suma se queda muy por debajo del límite.
// connectionTimeoutMillis hace que, si el pool alguna vez sí se agota, la
// request falle rápido con un error claro en vez de colgarse indefinidamente.
function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
