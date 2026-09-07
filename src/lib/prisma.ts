import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Confirmado 2026-09-07 — causa real de una caída de producción: cada
// instancia serverless de Vercel abre su propio pool hacia el pooler de
// Supabase (puerto 6543, pgbouncer=true), y sin un `max` explícito, pg.Pool
// usa 10 por default. Con suficiente tráfico concurrente, Vercel levanta
// muchas instancias a la vez, cada una reteniendo hasta 10 conexiones
// mientras sigue "tibia" (no se cierran solas entre invocaciones) — se llegó
// al límite del pooler (200) y TODA la app empezó a fallar, no solo una
// pantalla. `max: 3` deja mucho más margen: aunque haya decenas de
// instancias vivas a la vez, la suma total se mantiene lejos del límite.
// connectionTimeoutMillis además hace que, si alguna vez el pool sí se
// agota, la request falle rápido con un error claro en vez de colgarse
// esperando una conexión libre.
function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
