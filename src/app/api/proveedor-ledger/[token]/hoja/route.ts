import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { findSupplierByPublicSheetToken } from "@/lib/supplierDebt";
import { getSheetViewer } from "@/lib/supplierSheetAccess";
import { SHEET_MAX_COLS, SHEET_MAX_ROWS } from "@/lib/supplierSheet";

// Confirmado 2026-09-24, pedido explícito del usuario: la hoja de cálculo en
// línea del equipo de CHEN. Sin auth() a propósito (no tienen cuenta) — el
// acceso es SOLO por el token de la hoja (publicSheetToken), que nunca abre
// el saldo ni los envíos. Se guarda celda por celda (no la hoja entera) para
// que dos personas escribiendo a la vez no se borren lo del otro.
// Confirmado 2026-09-24: además del token, exige sesión de un correo de la
// lista del admin (getSheetViewer). Las hojas con candado (locked) las llena
// DAFLOW sola — nadie de CHEN las puede cambiar, renombrar ni borrar.

async function resolveSupplier(token: string) {
  const supplier = await findSupplierByPublicSheetToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") return null;
  return supplier;
}

const styleSchema = z
  .object({
    b: z.boolean().optional(),
    i: z.boolean().optional(),
    u: z.boolean().optional(),
    st: z.boolean().optional(),
    fc: z.string().max(20).optional(),
    bg: z.string().max(20).optional(),
    al: z.enum(["left", "center", "right"]).optional(),
    fs: z.number().int().min(6).max(48).optional(),
    fmt: z.enum(["currency", "percent", "number"]).optional(),
    dp: z.number().int().min(0).max(10).optional(),
  })
  .nullable();

const opSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("set"),
    tabId: z.string().min(1),
    r: z.number().int().min(0).max(SHEET_MAX_ROWS - 1),
    c: z.number().int().min(0).max(SHEET_MAX_COLS - 1),
    v: z.string().max(10000),
    s: styleSchema,
  }),
  z.object({ t: z.literal("addTab"), name: z.string().trim().min(1).max(60) }),
  z.object({ t: z.literal("renameTab"), tabId: z.string().min(1), name: z.string().trim().min(1).max(60) }),
  z.object({ t: z.literal("deleteTab"), tabId: z.string().min(1) }),
  z.object({ t: z.literal("colWidth"), tabId: z.string().min(1), c: z.number().int().min(0).max(SHEET_MAX_COLS - 1), w: z.number().int().min(30).max(800) }),
]);

const bodySchema = z.object({ ops: z.array(opSchema).min(1).max(5000) });

async function loadSheet(supplierId: string) {
  let tabs = await prisma.supplierSheetTab.findMany({
    where: { supplierId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { cells: { select: { row: true, col: true, value: true, style: true } } },
  });
  if (tabs.length === 0) {
    await prisma.supplierSheetTab.create({ data: { supplierId, name: "Hoja 1", position: 0 } });
    tabs = await prisma.supplierSheetTab.findMany({
      where: { supplierId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: { cells: { select: { row: true, col: true, value: true, style: true } } },
    });
  }
  return tabs.map((t) => ({
    id: t.id,
    name: t.name,
    colWidths: (t.colWidths as Record<string, number> | null) ?? {},
    locked: t.locked,
    cells: t.cells.map((c) => ({ r: c.row, c: c.col, v: c.value, s: c.style ?? null })),
  }));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await resolveSupplier(token);
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const viewer = await getSheetViewer(supplier.id);
  if (!viewer) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar con tu correo." }, { status: 401 });
  return NextResponse.json({ tabs: await loadSheet(supplier.id), canWrite: viewer.canWrite }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await resolveSupplier(token);
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const viewer = await getSheetViewer(supplier.id);
  if (!viewer) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar con tu correo." }, { status: 401 });
  if (!viewer.canWrite) return NextResponse.json({ error: "Tu correo solo tiene permiso para ver." }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const ownTabs = await prisma.supplierSheetTab.findMany({ where: { supplierId: supplier.id }, select: { id: true, position: true, locked: true } });
  // Solo las hojas libres se pueden tocar desde el enlace.
  const ownTabIds = new Set(ownTabs.filter((t) => !t.locked).map((t) => t.id));
  let nextPosition = ownTabs.reduce((m, t) => Math.max(m, t.position), -1) + 1;
  const createdTabIds: string[] = [];

  for (const op of parsed.data.ops) {
    if (op.t === "addTab") {
      const tab = await prisma.supplierSheetTab.create({ data: { supplierId: supplier.id, name: op.name, position: nextPosition++ } });
      ownTabIds.add(tab.id);
      createdTabIds.push(tab.id);
      continue;
    }
    if (!ownTabIds.has(op.tabId)) continue;

    if (op.t === "set") {
      const empty = op.v === "" && (!op.s || Object.keys(op.s).length === 0);
      if (empty) {
        await prisma.supplierSheetCell.deleteMany({ where: { tabId: op.tabId, row: op.r, col: op.c } });
      } else {
        const style = op.s && Object.keys(op.s).length > 0 ? op.s : undefined;
        await prisma.supplierSheetCell.upsert({
          where: { tabId_row_col: { tabId: op.tabId, row: op.r, col: op.c } },
          create: { tabId: op.tabId, row: op.r, col: op.c, value: op.v, style },
          update: { value: op.v, style: style ?? Prisma.DbNull },
        });
      }
    } else if (op.t === "renameTab") {
      await prisma.supplierSheetTab.update({ where: { id: op.tabId }, data: { name: op.name } });
    } else if (op.t === "deleteTab") {
      // Siempre queda al menos una hoja.
      if (ownTabIds.size <= 1) continue;
      await prisma.supplierSheetTab.delete({ where: { id: op.tabId } });
      ownTabIds.delete(op.tabId);
    } else if (op.t === "colWidth") {
      const tab = await prisma.supplierSheetTab.findUnique({ where: { id: op.tabId }, select: { colWidths: true } });
      const widths = { ...((tab?.colWidths as Record<string, number> | null) ?? {}), [String(op.c)]: op.w };
      await prisma.supplierSheetTab.update({ where: { id: op.tabId }, data: { colWidths: widths } });
    }
  }

  return NextResponse.json({ ok: true, createdTabIds });
}
