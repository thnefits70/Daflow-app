import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// TEMPORAL — 2026-08-29: la línea de comandos de Prisma (migrate deploy)
// no puede correr en este entorno porque el pooler de Supabase (pgbouncer,
// modo transacción) choca con los prepared statements del motor de
// migraciones ("prepared statement already exists"). El cliente de Prisma
// (el mismo que usa toda la app en runtime) sí funciona bien contra el
// pooler, así que esta ruta aplica la migración pendiente ejecutando el
// mismo SQL a mano, vía el cliente normal — ni más ni menos que lo que
// `migrate deploy` haría. Solo el admin puede llamarla (ver AdminLayout,
// ya redirige a cualquiera que no sea admin), es idempotente (revisa si ya
// se aplicó antes de tocar nada), y se borra después de usarse una vez.
const MIGRATION_NAME = "20260829160000_catalog_missing_reports_and_personal_purchase_link";

export async function POST() {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const already = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'CatalogMissingReport') as exists`
  );
  if (already[0]?.exists) return NextResponse.json({ status: "ya estaba aplicada" });

  const sqlPath = path.join(process.cwd(), "prisma", "migrations", MIGRATION_NAME, "migration.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");

  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const applied: string[] = [];
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
    applied.push(stmt.slice(0, 60));
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
    randomUUID(),
    checksum,
    MIGRATION_NAME
  );

  return NextResponse.json({ status: "aplicada", statements: applied.length });
}
