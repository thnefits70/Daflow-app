import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const DEFAULT_DEPARTMENTS = [
  { name: "Finanzas - Contabilidad", code: "FIN" },
  { name: "Diseño - Marketing", code: "DIS" },
  { name: "Fulfillment", code: "FUL" },
  { name: "Inventario", code: "INV" },
  { name: "Análisis de Mercado", code: "MKT" },
  { name: "Gestión de Compras", code: "COM" },
];

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "admin123";
  const adminPasswordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.platformSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", adminPasswordHash },
  });

  for (let i = 0; i < DEFAULT_DEPARTMENTS.length; i++) {
    const d = DEFAULT_DEPARTMENTS[i];
    const trackKpis = d.code === "FIN";
    const trackWeeklyMetric = d.code === "FUL";
    const trackWeeklyReview = ["MKT", "COM", "DIS", "INV", "FIN", "FUL"].includes(d.code);
    await prisma.department.upsert({
      where: { code: d.code },
      update: { trackKpis, trackWeeklyMetric, trackWeeklyReview },
      create: { name: d.name, code: d.code, order: i, trackKpis, trackWeeklyMetric, trackWeeklyReview },
    });
  }

  const finanzas = await prisma.department.findUnique({ where: { code: "FIN" } });
  if (finanzas) {
    const demoPasswordHash = await bcrypt.hash("demo1234", 12);
    await prisma.user.upsert({
      where: { username: "ana.perez" },
      update: {},
      create: {
        name: "Ana Pérez",
        username: "ana.perez",
        passwordHash: demoPasswordHash,
        deptId: finanzas.id,
        position: "Analista contable",
      },
    });
  }

  console.log("Seed completo.");
  console.log(`  Admin: contraseña "${adminPassword}" (cámbiala luego desde Configuración).`);
  console.log(`  Demo equipo: usuario "ana.perez" / contraseña "demo1234".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
