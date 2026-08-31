import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// TEMPORAL — 2026-08-31: mismo problema que en run-catalog-migration
// (prisma migrate deploy no puede correr contra el pooler pgbouncer de
// Supabase). Aplica a mano el ALTER TABLE que agrega clientName/clientPhone
// a ExternalSale, vía el cliente normal de Prisma. Idempotente. Borrar
// junto con la página una vez confirmado que corrió bien.
const MIGRATION_NAME = "20260831145222_external_sale_client_info";

export async function POST() {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const already = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ExternalSale' AND column_name = 'clientName') as exists`
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
